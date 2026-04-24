import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const ORIGENS_FIXAS = {
  ITAJAI: { cidade: 'Itajai', uf: 'SC', ibge: '4208203' },
  ITAJAÍ: { cidade: 'Itajai', uf: 'SC', ibge: '4208203' },
  BARUERI: { cidade: 'Barueri', uf: 'SP', ibge: '3505708' },
  CONTAGEM: { cidade: 'Contagem', uf: 'MG', ibge: '3118601' },
};

const MODELOS_FAIXA = {
  B2B: [
    { faixaPeso: '0 a 20', pesoInicial: 0, pesoFinal: 20 },
    { faixaPeso: '20 a 30', pesoInicial: 20, pesoFinal: 30 },
    { faixaPeso: '30 a 50', pesoInicial: 30, pesoFinal: 50 },
    { faixaPeso: '50 a 70', pesoInicial: 50, pesoFinal: 70 },
    { faixaPeso: '70 a 100', pesoInicial: 70, pesoFinal: 100 },
  ],
  B2C: [
    { faixaPeso: '0 a 2', pesoInicial: 0, pesoFinal: 2 },
    { faixaPeso: '2 a 5', pesoInicial: 2, pesoFinal: 5 },
    { faixaPeso: '5 a 10', pesoInicial: 5, pesoFinal: 10 },
    { faixaPeso: '10 a 15', pesoInicial: 10, pesoFinal: 15 },
    { faixaPeso: '15 a 20', pesoInicial: 15, pesoFinal: 20 },
  ],
};

const COTACOES_BASE = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4'];

function normalizar(txt) {
  return String(txt ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function limpar(txt) {
  return String(txt ?? '').trim();
}

function numero(txt) {
  if (txt === null || txt === undefined || txt === '') return null;
  if (typeof txt === 'number') return Number.isFinite(txt) ? txt : null;
  const s = String(txt).trim();
  if (!s) return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ufPorIbge(ibge) {
  const codigo = String(ibge ?? '').replace(/\D/g, '');
  return UF_POR_CODIGO[codigo.slice(0, 2)] || '';
}

function montarCotacaoFinal(origem, ibgeDestino, cotacaoBase) {
  const uf = ufPorIbge(ibgeDestino);
  return [limpar(origem), uf, limpar(cotacaoBase).toUpperCase()].filter(Boolean).join(' - ');
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);
  const m = bruto.match(/(\d+[.,]?\d*)\s*(?:a|até|ate|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!m) return { faixaPeso: bruto, pesoInicial: null, pesoFinal: null };
  return { faixaPeso: bruto, pesoInicial: numero(m[1]), pesoFinal: numero(m[2]) };
}

function baixarWorkbook(nome, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, nome);
}

function rotasParaExportacao(rotas) {
  if (!rotas.length) {
    return [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO BASE': '', 'COTAÇÃO FINAL': '' }];
  }
  return rotas.map((r) => ({
    'IBGE DESTINO': r.ibgeDestino,
    PRAZO: r.prazo,
    'COTAÇÃO BASE': r.cotacaoBase,
    'COTAÇÃO FINAL': r.cotacaoFinal,
  }));
}

function fretesParaExportacao(fretes) {
  if (!fretes.length) {
    return [{
      COTAÇÃO: '', 'FAIXA PESO': '', 'PESO INICIAL': '', 'PESO FINAL': '',
      'FRETE VALOR': '', 'AD VALOREM': '', 'FRETE MÍNIMO': '', 'TAXA APLICADA': '',
    }];
  }
  return fretes.map((f) => ({
    COTAÇÃO: f.cotacaoFinal,
    'FAIXA PESO': f.faixaPeso,
    'PESO INICIAL': f.pesoInicial,
    'PESO FINAL': f.pesoFinal,
    'FRETE VALOR': f.freteValor ?? '',
    'AD VALOREM': f.fretePercentual ?? '',
    'FRETE MÍNIMO': f.freteMinimo ?? '',
    'TAXA APLICADA': f.taxaAplicada ?? '',
  }));
}

async function lerPrimeiraAba(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function detectarCotacaoBase(regiao) {
  const t = normalizar(regiao);
  return COTACOES_BASE.find((c) => t.includes(c)) || limpar(regiao).toUpperCase();
}

async function importarTemplateSeparado(arquivoRotas, arquivoFretes) {
  const rowsRotas = await lerPrimeiraAba(arquivoRotas);
  const rowsFretes = await lerPrimeiraAba(arquivoFretes);

  const hRot = (rowsRotas[0] || []).map(normalizar);
  const idx = {
    cidadeOrigem: hRot.findIndex((h) => h === 'CIDADE DE ORIGEM'),
    ufOrigem: hRot.findIndex((h) => h === 'UF ORIGEM'),
    ibgeOrigem: hRot.findIndex((h) => h === 'IBGE ORIGEM'),
    ibgeDestino: hRot.findIndex((h) => h === 'IBGE DESTINO'),
    prazo: hRot.findIndex((h) => h.startsWith('PRAZO')),
    regiao: hRot.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO')),
  };

  const rotas = [];
  for (let i = 1; i < rowsRotas.length; i++) {
    const row = rowsRotas[i] || [];
    const ibgeDestino = limpar(row[idx.ibgeDestino]);
    const cotacaoBase = detectarCotacaoBase(row[idx.regiao]);
    if (!ibgeDestino || !cotacaoBase) continue;
    const origem = limpar(row[idx.cidadeOrigem]);
    rotas.push({
      id: `r${i}`,
      ibgeDestino,
      prazo: limpar(row[idx.prazo]),
      cotacaoBase,
      origem,
      cotacaoFinal: montarCotacaoFinal(origem, ibgeDestino, cotacaoBase),
    });
  }

  const h1 = (rowsFretes[0] || []).map(limpar);
  const h2 = (rowsFretes[1] || []).map(normalizar);
  const cols = Math.max(h1.length, h2.length);
  const fixed = { origem: -1, ufDestino: -1, faixa: -1 };
  const blocos = [];
  for (let c = 0; c < cols; c++) {
    const a = normalizar(h1[c]);
    const b = h2[c];
    if (a === 'CIDADE DE ORIGEM') fixed.origem = c;
    if (a === 'UF DESTINO') fixed.ufDestino = c;
    if (a === 'FAIXA PESO') fixed.faixa = c;
    if (a && b === 'FRETE KG (R$)') {
      blocos.push({ cotacaoBase: a, freteCol: c, adValCol: c + 1 });
    }
  }

  const fretes = [];
  for (let r = 2; r < rowsFretes.length; r++) {
    const row = rowsFretes[r] || [];
    const origem = limpar(row[fixed.origem]);
    const ufDestino = limpar(row[fixed.ufDestino]).toUpperCase();
    const faixa = extrairFaixa(row[fixed.faixa]);
    if (!origem || !ufDestino || !faixa.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = numero(row[bloco.freteCol]);
      const fretePercentual = numero(row[bloco.adValCol]);
      if (freteValor === null && fretePercentual === null) continue;
      fretes.push({
        id: `f${r}-${bloco.cotacaoBase}`,
        cotacaoBase: bloco.cotacaoBase,
        cotacaoFinal: [origem, ufDestino, bloco.cotacaoBase].join(' - '),
        faixaPeso: faixa.faixaPeso,
        pesoInicial: faixa.pesoInicial,
        pesoFinal: faixa.pesoFinal,
        freteValor,
        fretePercentual,
        freteMinimo: '',
        taxaAplicada: '',
      });
    }
  }

  const dadosGerais = {
    origemNome: rotas[0]?.origem || '',
    ufOrigem: limpar(rowsRotas[1]?.[idx.ufOrigem]).toUpperCase(),
    ibgeOrigem: limpar(rowsRotas[1]?.[idx.ibgeOrigem]),
  };

  return { rotas, fretes, dadosGerais };
}

export default function FormatacaoPage({ transportadoras = [] }) {
  const inputImportarRotas = useRef(null);
  const inputImportarFretes = useRef(null);
  const [modoEntrada, setModoEntrada] = useState('escolha');
  const [arquivoRotasTemplate, setArquivoRotasTemplate] = useState(null);
  const [arquivoFretesTemplate, setArquivoFretesTemplate] = useState(null);
  const [carregandoTemplate, setCarregandoTemplate] = useState(false);

  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
    canal: 'ATACADO',
    metodoEnvio: 'NORMAL',
    tipoCalculo: 'FAIXA_PESO',
    modeloFaixa: 'B2B',
  });

  const [rotas, setRotas] = useState([]);
  const [fretes, setFretes] = useState([]);

  const faixasAtuais = useMemo(() => MODELOS_FAIXA[dadosGerais.modeloFaixa] || [], [dadosGerais.modeloFaixa]);

  function atualizarOrigem(valor) {
    const chave = normalizar(valor);
    const fixa = ORIGENS_FIXAS[chave];
    setDadosGerais((prev) => ({
      ...prev,
      origemNome: valor,
      ufOrigem: fixa?.uf || prev.ufOrigem,
      ibgeOrigem: fixa?.ibge || prev.ibgeOrigem,
    }));
    setRotas((prev) =>
      prev.map((r) => ({
        ...r,
        origem: valor,
        cotacaoFinal: montarCotacaoFinal(valor, r.ibgeDestino, r.cotacaoBase),
      }))
    );
  }

  function adicionarRota() {
    setRotas((prev) => [
      ...prev,
      {
        id: `r${Date.now()}`,
        ibgeDestino: '',
        prazo: '',
        cotacaoBase: 'CAPITAL',
        origem: dadosGerais.origemNome,
        cotacaoFinal: '',
      },
    ]);
  }

  function atualizarRota(id, campo, valor) {
    setRotas((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [campo]: valor, origem: dadosGerais.origemNome };
        next.cotacaoFinal = montarCotacaoFinal(dadosGerais.origemNome, next.ibgeDestino, next.cotacaoBase);
        return next;
      })
    );
  }

  async function importarRotas(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = (rows[0] || []).map(normalizar);
    const idxIbge = header.findIndex((h) => h === 'IBGE DESTINO');
    const idxPrazo = header.findIndex((h) => h.startsWith('PRAZO'));
    const idxCot = header.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO') || h.startsWith('COTAÇÃO BASE') || h.startsWith('COTACAO BASE'));
    const novas = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ibgeDestino = limpar(row[idxIbge]);
      if (!ibgeDestino) continue;
      const cotacaoBase = idxCot >= 0 ? detectarCotacaoBase(row[idxCot]) : 'CAPITAL';
      novas.push({
        id: `ri${i}`,
        ibgeDestino,
        prazo: limpar(row[idxPrazo]),
        cotacaoBase,
        origem: dadosGerais.origemNome,
        cotacaoFinal: montarCotacaoFinal(dadosGerais.origemNome, ibgeDestino, cotacaoBase),
      });
    }
    setRotas(novas);
    event.target.value = '';
  }

  function aplicarFaixasEGerarFretes() {
    const unicas = Array.from(new Map(rotas.map((r) => [r.cotacaoFinal, r])).values());
    const gerados = [];
    unicas.forEach((rota) => {
      faixasAtuais.forEach((faixa, idx) => {
        gerados.push({
          id: `${rota.cotacaoFinal}-${idx}`,
          cotacaoBase: rota.cotacaoBase,
          cotacaoFinal: rota.cotacaoFinal,
          faixaPeso: faixa.faixaPeso,
          pesoInicial: faixa.pesoInicial,
          pesoFinal: faixa.pesoFinal,
          freteValor: '',
          fretePercentual: '',
          freteMinimo: '',
          taxaAplicada: '',
        });
      });
    });
    setFretes(gerados);
  }

  async function importarFretes(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = (rows[0] || []).map(normalizar);
    const idx = {
      cotacao: header.findIndex((h) => h === 'COTAÇÃO' || h === 'COTACAO'),
      faixa: header.findIndex((h) => h === 'FAIXA PESO'),
      pesoInicial: header.findIndex((h) => h === 'PESO INICIAL'),
      pesoFinal: header.findIndex((h) => h === 'PESO FINAL'),
      freteValor: header.findIndex((h) => h === 'FRETE VALOR'),
      adValorem: header.findIndex((h) => h === 'AD VALOREM'),
      freteMinimo: header.findIndex((h) => h === 'FRETE MÍNIMO' || h === 'FRETE MINIMO'),
      taxaAplicada: header.findIndex((h) => h === 'TAXA APLICADA'),
    };
    const novos = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const cotacaoFinal = limpar(row[idx.cotacao]);
      if (!cotacaoFinal) continue;
      novos.push({
        id: `fi${i}`,
        cotacaoFinal,
        faixaPeso: limpar(row[idx.faixa]),
        pesoInicial: limpar(row[idx.pesoInicial]),
        pesoFinal: limpar(row[idx.pesoFinal]),
        freteValor: limpar(row[idx.freteValor]),
        fretePercentual: limpar(row[idx.adValorem]),
        freteMinimo: limpar(row[idx.freteMinimo]),
        taxaAplicada: limpar(row[idx.taxaAplicada]),
      });
    }
    setFretes(novos);
    event.target.value = '';
  }

  function limparTudo() {
    setRotas([]);
    setFretes([]);
    setArquivoRotasTemplate(null);
    setArquivoFretesTemplate(null);
    setModoEntrada('escolha');
  }

  async function importarTemplateAutomatico() {
    if (!arquivoRotasTemplate || !arquivoFretesTemplate) return;
    setCarregandoTemplate(true);
    try {
      const resultado = await importarTemplateSeparado(arquivoRotasTemplate, arquivoFretesTemplate);
      setDadosGerais((prev) => ({
        ...prev,
        origemNome: resultado.dadosGerais.origemNome || prev.origemNome,
        ufOrigem: resultado.dadosGerais.ufOrigem || prev.ufOrigem,
        ibgeOrigem: resultado.dadosGerais.ibgeOrigem || prev.ibgeOrigem,
      }));
      setRotas(resultado.rotas);
      setFretes(resultado.fretes);
      setModoEntrada('manual');
    } finally {
      setCarregandoTemplate(false)
    }
  }

  function atualizarFrete(id, campo, valor) {
    setFretes((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  if (modoEntrada === 'escolha') {
    return (
      <div className="pagina">
        <div className="cabecalho-pagina">
          <div>
            <h2>Formatação de Tabelas</h2>
            <p>Escolha como deseja começar a formatação.</p>
          </div>
        </div>

        <div className="formatacao-escolha-grid">
          <section className="card-padrao">
            <div className="card-topo"><h3>Enviar template padrão</h3></div>
            <p className="formatacao-texto">Anexe os dois arquivos do modelo padrão para formatar automaticamente.</p>
            <div className="form-grid">
              <label>
                Arquivo de Rotas
                <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoRotasTemplate(e.target.files?.[0] || null)} />
              </label>
              <label>
                Arquivo de Fretes
                <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoFretesTemplate(e.target.files?.[0] || null)} />
              </label>
            </div>
            <div className="acoes-formulario">
              <button className="botao-primario" disabled={!arquivoRotasTemplate || !arquivoFretesTemplate || carregandoTemplate} onClick={importarTemplateAutomatico}>
                {carregandoTemplate ? 'Importando...' : 'Importar e formatar automaticamente'}
              </button>
            </div>
          </section>

          <section className="card-padrao">
            <div className="card-topo"><h3>Usar modelo criado na ferramenta</h3></div>
            <p className="formatacao-texto">Entre no fluxo manual para cadastrar rotas, aplicar faixas, gerar fretes e exportar modelo para preenchimento.</p>
            <div className="acoes-formulario">
              <button className="botao-secundario" onClick={() => setModoEntrada('manual')}>
                Ir para o modelo criado
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Formatação de Tabelas</h2>
          <p>Fluxo manual com rotas, aplicação de faixas, geração de fretes e importação/exportação.</p>
        </div>
      </div>

      <section className="card-padrao">
        <div className="card-topo"><h3>Dados gerais</h3></div>
        <div className="form-grid">
          <label>
            Transportadora
            <select value={dadosGerais.transportadora} onChange={(e) => setDadosGerais((p) => ({ ...p, transportadora: e.target.value }))}>
              {transportadoras.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
            </select>
          </label>
          <label>
            Origem
            <input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} placeholder="Ex.: Itajai" />
          </label>
          <label>
            UF origem
            <input value={dadosGerais.ufOrigem} onChange={(e) => setDadosGerais((p) => ({ ...p, ufOrigem: e.target.value.toUpperCase() }))} />
          </label>
          <label>
            IBGE origem
            <input value={dadosGerais.ibgeOrigem} onChange={(e) => setDadosGerais((p) => ({ ...p, ibgeOrigem: e.target.value }))} />
          </label>
          <label>
            Canal
            <select value={dadosGerais.canal} onChange={(e) => setDadosGerais((p) => ({ ...p, canal: e.target.value }))}>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Modelo de faixa
            <select value={dadosGerais.modeloFaixa} onChange={(e) => setDadosGerais((p) => ({ ...p, modeloFaixa: e.target.value }))}>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Rotas</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarRotas} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarRotas} />
            <button className="botao-secundario" onClick={() => baixarWorkbook('Rotas-modelo.xlsx', [{ name: 'Rotas', rows: rotasParaExportacao(rotas) }])}>Exportar modelo</button>
            <button className="botao-secundario" onClick={() => inputImportarRotas.current?.click()}>Importar rotas</button>
            <button className="botao-secundario" onClick={adicionarRota}>Adicionar rota</button>
            <button className="botao-secundario" onClick={limparTudo}>Limpar tudo</button>
          </div>
        </div>

        <div className="lista-tabela">
          <div className="linha cabecalho" style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1.1fr 0.5fr' }}>
            <span>IBGE destino</span>
            <span>Prazo</span>
            <span>Cotação base</span>
            <span>Cotação final</span>
            <span>Ações</span>
          </div>

          {rotas.map((rota) => (
            <div key={rota.id} className="linha" style={{ gridTemplateColumns: '1fr 1fr 0.9fr 1.1fr 0.5fr', alignItems: 'center' }}>
              <input value={rota.ibgeDestino} onChange={(e) => atualizarRota(rota.id, 'ibgeDestino', e.target.value)} />
              <input value={rota.prazo} onChange={(e) => atualizarRota(rota.id, 'prazo', e.target.value)} />
              <select value={rota.cotacaoBase} onChange={(e) => atualizarRota(rota.id, 'cotacaoBase', e.target.value)}>
                {COTACOES_BASE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span>{rota.cotacaoFinal}</span>
              <button className="botao-link" onClick={() => setRotas((prev) => prev.filter((x) => x.id !== rota.id))}>Remover</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Fretes</h3>
          <div className="acoes-formulario">
            <input ref={inputImportarFretes} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarFretes} />
            <button className="botao-primario" onClick={aplicarFaixasEGerarFretes}>Aplicar faixas e gerar fretes</button>
            <button className="botao-secundario" onClick={() => baixarWorkbook('Fretes-modelo.xlsx', [{ name: 'Fretes', rows: fretesParaExportacao(fretes) }])}>Exportar modelo</button>
            <button className="botao-secundario" onClick={() => inputImportarFretes.current?.click()}>Importar fretes</button>
          </div>
        </div>

        <div className="lista-tabela">
          <div className="linha cabecalho" style={{ gridTemplateColumns: '1.3fr 0.8fr 0.6fr 0.6fr 0.7fr 0.7fr 0.5fr' }}>
            <span>Cotação</span>
            <span>Faixa</span>
            <span>Peso inicial</span>
            <span>Peso final</span>
            <span>Frete valor</span>
            <span>Ad valorem</span>
            <span>Taxa</span>
          </div>
          {fretes.map((f) => (
            <div key={f.id} className="linha" style={{ gridTemplateColumns: '1.3fr 0.8fr 0.6fr 0.6fr 0.7fr 0.7fr 0.5fr', alignItems: 'center' }}>
              <span>{f.cotacaoFinal}</span>
              <span>{f.faixaPeso}</span>
              <span>{f.pesoInicial}</span>
              <span>{f.pesoFinal}</span>
              <input value={f.freteValor} onChange={(e) => atualizarFrete(f.id, 'freteValor', e.target.value)} />
              <input value={f.fretePercentual} onChange={(e) => atualizarFrete(f.id, 'fretePercentual', e.target.value)} />
              <input value={f.taxaAplicada} onChange={(e) => atualizarFrete(f.id, 'taxaAplicada', e.target.value)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
