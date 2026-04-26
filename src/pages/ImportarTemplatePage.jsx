import { useState } from 'react';
import { importarTemplatePadraoSeparado } from '../utils/importadorTemplatePadrao';
import { baixarModeloTemplateFretes, baixarModeloTemplateRotas } from '../utils/modelosTemplateFormatacao';

export default function ImportarTemplatePage() {
  const [arquivoRotas, setArquivoRotas] = useState(null);
  const [arquivoFretes, setArquivoFretes] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [mensagem, setMensagem] = useState('');

  async function processarTemplate() {
    try {
      setMensagem('');
      const convertido = await importarTemplatePadraoSeparado({ arquivoRotas, arquivoFretes });
      setResultado(convertido);
      setMensagem(`Template lido com sucesso: ${convertido.rotas.length} rota(s), ${convertido.quebrasFaixa.length} quebra(s) e ${convertido.fretes.length} frete(s).`);
    } catch (error) {
      setResultado(null);
      setMensagem(error?.message || 'Não foi possível importar o template.');
    }
  }

  return (
    <div className="page-shell formatacao-shell">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">Importação separada</div>
          <h1>Importar Template</h1>
          <p>Use esta tela somente para o template preenchido pelo transportador. A formatação manual continua separada em Formatação de Tabelas.</p>
        </div>
      </div>

      {mensagem ? <div className="formatacao-alert">{mensagem}</div> : null}

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Modelos oficiais</h3>
          <div className="inline-actions-wrap">
            <button className="btn-secondary" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
            <button className="btn-secondary" onClick={baixarModeloTemplateFretes}>Baixar modelo de Fretes</button>
          </div>
        </div>
        <div className="feature-grid three-cols">
          <div className="info-card compact-info-card">
            <strong>1. Baixe os modelos</strong>
            <p>Assim você garante que as colunas estão exatamente no padrão que o sistema lê.</p>
          </div>
          <div className="info-card compact-info-card">
            <strong>2. Preencha Rotas + Fretes</strong>
            <p>Rotas ficam em um arquivo e valores de frete em outro arquivo.</p>
          </div>
          <div className="info-card compact-info-card">
            <strong>3. Importe e valide</strong>
            <p>O sistema mostra a quantidade de rotas, quebras e fretes encontrados antes de seguir.</p>
          </div>
        </div>
      </section>

      <section className="panel-card formatacao-section">
        <div className="section-header-inline">
          <h3>Importar arquivos preenchidos</h3>
        </div>
        <div className="formatacao-grid two">
          <label className="field-block">
            <span>Arquivo de Rotas</span>
            <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoRotas(e.target.files?.[0] || null)} />
          </label>
          <label className="field-block">
            <span>Arquivo de Fretes</span>
            <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={(e) => setArquivoFretes(e.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="inline-actions-wrap compact-top-gap">
          <button className="btn-primary" onClick={processarTemplate}>Ler template</button>
        </div>
      </section>

      {resultado ? (
        <section className="panel-card formatacao-section">
          <div className="section-header-inline">
            <h3>Prévia da leitura</h3>
          </div>
          <div className="feature-grid three-cols">
            <div className="info-card compact-info-card"><strong>Rotas</strong><p>{resultado.rotas.length}</p></div>
            <div className="info-card compact-info-card"><strong>Quebras</strong><p>{resultado.quebrasFaixa.length}</p></div>
            <div className="info-card compact-info-card"><strong>Fretes</strong><p>{resultado.fretes.length}</p></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
