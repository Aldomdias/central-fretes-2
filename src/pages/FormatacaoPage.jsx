import { useState } from 'react';
import * as XLSX from 'xlsx';

const ORIGENS_FIXAS = {
  ITAJAI: { uf: 'SC', ibge: '4208203' },
  'ITAJAÍ': { uf: 'SC', ibge: '4208203' },
  CURITIBA: { uf: 'PR', ibge: '4106902' },
  BARUERI: { uf: 'SP', ibge: '3505708' },
  CONTAGEM: { uf: 'MG', ibge: '3118601' },
  SERRA: { uf: 'ES', ibge: '3205002' },
};

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

function baixarModeloTemplateRotasSemOrigem() {
  baixarWorkbook('Rotas-modelo-template.xlsx', [{
    name: 'Rotas',
    rows: [
      { 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 1, 'REGIÃO': 'CAPITAL' },
      { 'IBGE DESTINO': '4106902', 'CIDADE DE DESTINO': 'Curitiba', 'UF DESTINO': 'PR', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 2, 'REGIÃO': 'INTERIOR 1' },
    ],
  }]);
}

function baixarModeloTemplateFretesSemOrigem() {
  baixarWorkbook('Fretes-modelo-template.xlsx', [{
    name: 'Fretes',
    rows: [
      { 'UF DESTINO': 'PR', 'FAIXA PESO': '0 a 10 kg', 'CAPITAL Frete kg (R$)': 80, 'CAPITAL Ad Valorem(%)': 0.03, 'INTERIOR 1 Frete kg (R$)': 80, 'INTERIOR 1 Ad Valorem(%)': 0.03 },
      { 'UF DESTINO': 'PR', 'FAIXA PESO': 'Acima de 300 kg (KG excedente)', 'CAPITAL Frete kg (R$)': 0.95, 'CAPITAL Ad Valorem(%)': 0.03, 'INTERIOR 1 Frete kg (R$)': 0.95, 'INTERIOR 1 Ad Valorem(%)': 0.03 },
    ],
  }]);
}

export default function FormatacaoPage({ transportadoras = [] }) {
  const [modoEntrada, setModoEntrada] = useState('escolha');
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [msg, setMsg] = useState('');
  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
  });

  function atualizarOrigem(valor) {
    const fixa = ORIGENS_FIXAS[normalizar(valor)];
    setDadosGerais((prev) => ({
      ...prev,
      origemNome: valor,
      ufOrigem: fixa?.uf || '',
      ibgeOrigem: fixa?.ibge || '',
    }));
  }

  async function importarTemplate() {
    if (!arquivoRotas || !arquivoFretes) return;
    if (!dadosGerais.origemNome || !dadosGerais.ufOrigem || !dadosGerais.ibgeOrigem) {
      setMsg('Preencha a origem antes de importar o template.');
      return;
    }
    setMsg(`Template pronto para importar usando origem ${dadosGerais.origemNome} / ${dadosGerais.ufOrigem} / ${dadosGerais.ibgeOrigem}.`);
    setModoEntrada('manual');
  }

  if (modoEntrada === 'escolha') {
    return (
      <div className="pagina">
        <div className="cabecalho-pagina">
          <div>
            <h2>Formatação de Tabelas</h2>
            <p>Defina primeiro a origem e depois use o template padrão.</p>
          </div>
        </div>

        {msg ? <section className="card-padrao" style={{ marginBottom: 12 }}>{msg}</section> : null}

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
          <p>Use exatamente estes modelos. A origem será puxada da tela, então não precisa preenchê-la no arquivo.</p>

          <div className="acoes-formulario">
            <button className="botao-secundario" type="button" onClick={baixarModeloTemplateRotasSemOrigem}>
              Baixar modelo de Rotas
            </button>
            <button className="botao-secundario" type="button" onClick={baixarModeloTemplateFretesSemOrigem}>
              Baixar modelo de Fretes
            </button>
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
            <button className="botao-primario" type="button" disabled={!arquivoRotas || !arquivoFretes} onClick={importarTemplate}>
              Importar e formatar automaticamente
            </button>
            <button className="botao-secundario" type="button" onClick={() => setModoEntrada('manual')}>
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
          <p>Origem já definida antes do template. Agora siga no fluxo manual.</p>
        </div>
        <div className="acoes-formulario">
          <button className="botao-secundario" type="button" onClick={() => setModoEntrada('escolha')}>
            Voltar à escolha inicial
          </button>
        </div>
      </div>

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
    </div>
  );
}
