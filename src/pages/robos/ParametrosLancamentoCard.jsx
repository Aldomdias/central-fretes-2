import { useEffect, useRef, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { carregarParametrosRemotos, salvarParametrosRemotos } from '../../services/robosParametrosService';
import { baixarParametrosXlsx, extrairParametrosDeArquivo, guardarCopiaLocal, isoParaBr, salvarParametros } from '../../utils/robos/lancamentoComum';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

const AVISO_SEM_TABELA = 'O banco ainda não tem a tabela de parâmetros (migration pendente): as listas ficam só neste navegador por enquanto.';

// Tabelas de Filiais e Escritorios BI (antes vinham do Parametros.xlsx via Power Query).
// Ficam no banco da plataforma (toda a equipe usa as mesmas) com copia neste navegador.
export default function ParametrosLancamentoCard({ parametros, onChange, onErro, onFeedback }) {
  const ref = useRef(null);
  const [fonte, setFonte] = useState('');
  const [aviso, setAviso] = useState('');
  const semTabelas = !parametros.filiais.length || !parametros.escritorios.length;

  // Ao abrir: o banco e a fonte da verdade. Se ele estiver vazio e este navegador ja tiver as
  // listas, sobe a copia local (quem ja importou antes nao precisa importar de novo).
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await carregarParametrosRemotos();
      if (!vivo) return;
      if (!r.ok) {
        setFonte('navegador');
        if (r.tabelaAusente) setAviso(AVISO_SEM_TABELA);
        return;
      }
      const temLocal = parametros.filiais.length && parametros.escritorios.length;
      if (r.vazio) {
        if (temLocal) {
          const s = await salvarParametrosRemotos(parametros, carregarSessao()?.nome || carregarSessao()?.email);
          if (vivo) setFonte(s.ok ? 'banco' : 'navegador');
        } else setFonte('banco');
        return;
      }
      const localMaisNovo = temLocal && parametros.atualizadoEm && new Date(parametros.atualizadoEm) > new Date(r.atualizadoEm);
      if (localMaisNovo) {
        const s = await salvarParametrosRemotos(parametros, carregarSessao()?.nome || carregarSessao()?.email);
        if (vivo) setFonte(s.ok ? 'banco' : 'navegador');
        return;
      }
      onChange(guardarCopiaLocal({ filiais: r.filiais, escritorios: r.escritorios, atualizadoEm: r.atualizadoEm }));
      setFonte('banco');
    })();
    return () => { vivo = false; };
    // roda so na abertura da tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importar(arquivo) {
    if (!arquivo) return;
    onErro('');
    try {
      const r = await extrairParametrosDeArquivo(arquivo);
      const novo = salvarParametros(r);
      onChange(novo);
      const s = await salvarParametrosRemotos(novo, carregarSessao()?.nome || carregarSessao()?.email);
      setFonte(s.ok ? 'banco' : 'navegador');
      setAviso(s.ok ? '' : (s.tabelaAusente ? AVISO_SEM_TABELA : `Não consegui gravar no banco (${s.motivo}). Ficou só neste navegador.`));
      onFeedback(`Tabelas atualizadas: ${fmt(novo.filiais.length)} filiais e ${fmt(novo.escritorios.length)} centros de custo${s.ok ? ' — salvas no banco para toda a equipe.' : '.'}`);
    } catch (e) {
      onErro(e.message || 'Nao consegui ler as tabelas.');
    } finally {
      if (ref.current) ref.current.value = '';
    }
  }

  return (
    <div className="panel-card">
      <div className="panel-title">Tabelas de parâmetros</div>
      <p>Filiais (empresa e centro pelo CNPJ do tomador) e Escritórios BI (centro de custo). Importe o <code>Parâmetros.xlsx</code> (ou uma planilha de lançamento que tenha as abas Filiais_Cantu e Escritorios BI). Fica salvo no banco da plataforma. Para ajustar (filial nova, centro de custo novo), baixe as tabelas, edite no Excel e importe de volta.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={ref} type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => importar(e.target.files?.[0])} />
        <button type="button" className="btn-secondary" disabled={semTabelas} onClick={() => baixarParametrosXlsx(parametros)}>Baixar tabelas (.xlsx)</button>
        <span style={{ color: semTabelas ? '#b91c1c' : '#334155' }}>
          {semTabelas ? 'Tabelas ainda não importadas.' : `${fmt(parametros.filiais.length)} filiais · ${fmt(parametros.escritorios.length)} centros de custo · atualizado em ${isoParaBr((parametros.atualizadoEm || '').slice(0, 10))}`}
          {!semTabelas && fonte === 'banco' ? ' · ✓ no banco' : ''}
          {!semTabelas && fonte === 'navegador' ? ' · só neste navegador' : ''}
        </span>
      </div>
      {aviso ? <div style={{ marginTop: 8, fontSize: 12, color: '#b45309' }}>{aviso}</div> : null}
    </div>
  );
}
