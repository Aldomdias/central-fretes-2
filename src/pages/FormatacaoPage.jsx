import { Component } from 'react';
import FormatacaoTabelasPage from './FormatacaoTabelasPage';

class FormatacaoErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(error) {
    return { erro: error };
  }

  componentDidCatch(error, info) {
    console.error('Erro na tela Formatação de Tabelas:', error, info);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="page-shell formatacao-shell">
          <div className="page-top between">
            <div className="page-header">
              <div className="amd-mini-brand">Cadastro guiado</div>
              <h1>Formatação de Tabelas</h1>
              <p>A tela não carregou porque algum dado salvo no navegador ficou incompatível com a versão atual.</p>
            </div>
          </div>

          <section className="panel-card formatacao-section">
            <div className="section-header-inline">
              <h3>Recuperação da tela</h3>
            </div>
            <div className="formatacao-alert">
              Encontramos um erro ao abrir a Formatação de Tabelas. Clique em limpar dados locais da formatação e abra a tela novamente.
            </div>
            <div className="inline-actions-wrap compact-top-gap">
              <button
                className="btn-primary"
                onClick={() => {
                  localStorage.removeItem('formatacao_tabelas_rascunhos_v1');
                  localStorage.removeItem('formatacao_tabelas_cadastros_v1');
                  localStorage.removeItem('formatacao_tabelas_faixas_v1');
                  window.location.reload();
                }}
              >
                Limpar dados locais da formatação
              </button>
            </div>
            <div className="empty-note">
              Detalhe técnico: {String(this.state.erro?.message || this.state.erro || 'erro desconhecido')}
            </div>
          </section>
        </div>
      );
    }

    return <FormatacaoTabelasPage {...this.props} />;
  }
}

export default function FormatacaoPage(props) {
  return (
    <FormatacaoErrorBoundary>
      <FormatacaoTabelasPage {...props} />
    </FormatacaoErrorBoundary>
  );
}
