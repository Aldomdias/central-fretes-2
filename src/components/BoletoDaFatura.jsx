import { useEffect, useState } from 'react';
import { baixarBoletoGuardado, carregarBoletoDaFatura, urlBoletoGuardado } from '../services/boletoControleService';

// Boleto guardado da fatura (pelo robo de boletos ou pelo painel): abrir/baixar o PDF sem sair da fatura.
const dinheiro = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

export default function BoletoDaFatura({ fatura }) {
  const [dados, setDados] = useState({ controle: null, versoes: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [verVersoes, setVerVersoes] = useState(false);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    carregarBoletoDaFatura(fatura?.id)
      .then((d) => { if (ativo) { setDados(d); setErro(''); } })
      .catch((e) => { if (ativo) setErro(e.message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [fatura?.id]);

  const abrir = async (path) => {
    try { window.open(await urlBoletoGuardado(path), '_blank', 'noopener'); } catch (e) { setErro(e.message); }
  };
  const baixar = async (path, nome) => {
    try {
      const blob = await baixarBoletoGuardado(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome || `boleto-${fatura.numero_fatura}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErro(e.message); }
  };

  const c = dados.controle;
  const anteriores = dados.versoes.filter((v) => v.arquivo_path && v.arquivo_path !== c?.boleto_arquivo_path);
  const diverge = c?.boleto_valor != null && Math.abs(Number(c.boleto_valor) - Number(fatura.valor_fatura || 0)) > 0.01;
  const cor = !c ? '#94a3b8' : c.status === 'DISPENSADO' ? '#64748b' : diverge ? '#b45309' : '#14733b';

  return (
    <div className="hint-box compact" style={{ marginBottom: 14, borderLeft: `4px solid ${cor}` }}>
      <strong style={{ display: 'block', marginBottom: 6 }}>Boleto da fatura</strong>
      {carregando ? <span style={{ fontSize: 12 }}>Carregando…</span> : !c ? (
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Nenhum boleto guardado. Quando o boleto entrar na pasta “Verum protocolo - Boletos” com o nome <em>{String(fatura.numero_fatura || '').replace(/^0+/, '')} - transportadora.pdf</em>, o robô de boletos acha e ele aparece aqui.
        </span>
      ) : c.status === 'DISPENSADO' ? (
        <span style={{ fontSize: 12 }}>Dispensada de boleto{c.observacao ? `: ${c.observacao}` : ''} (por {c.confirmado_por || '-'} em {dataHora(c.confirmado_em)}).</span>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
            <span>Valor: <strong style={{ color: diverge ? '#b45309' : undefined }}>{dinheiro(c.boleto_valor)}</strong>{diverge && <span style={{ color: '#b45309' }}> (fatura {dinheiro(fatura.valor_fatura)})</span>}</span>
            <span>Vencimento: <strong>{dataBr(c.boleto_vencimento)}</strong></span>
            <span>Arquivo: {c.boleto_arquivo_nome || '-'}</span>
            {c.boleto_arquivo_path ? (
              <>
                <button type="button" className="btn-primary audit-small-button" onClick={() => abrir(c.boleto_arquivo_path)}>Abrir boleto</button>
                <button type="button" className="btn-secondary audit-small-button" onClick={() => baixar(c.boleto_arquivo_path, c.boleto_arquivo_nome)}>Baixar</button>
              </>
            ) : (
              <span style={{ color: '#64748b' }}>PDF apagado{c.boleto_apagado_motivo === 'PAGA' ? ' após o pagamento' : ''}{c.boleto_apagado_em ? ` em ${dataBr(c.boleto_apagado_em)}` : ''} — os dados ficam guardados.</span>
            )}
          </div>
          {c.boleto_linha_digitavel && (
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Linha digitável: <code style={{ userSelect: 'all' }}>{c.boleto_linha_digitavel}</code>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            Guardado por {c.confirmado_por || '-'} em {dataHora(c.confirmado_em)}
            {anteriores.length > 0 && (
              <> · <button type="button" className="link-button" style={{ fontSize: 11 }} onClick={() => setVerVersoes((v) => !v)}>{verVersoes ? 'ocultar' : 'ver'} {anteriores.length} boleto(s) anterior(es)</button></>
            )}
          </div>
          {verVersoes && anteriores.length > 0 && (
            <ul style={{ margin: '6px 0 0 18px', fontSize: 12 }}>
              {anteriores.map((v) => (
                <li key={v.id || v.hash_conteudo}>
                  {dataHora(v.created_at)} · {v.nome_arquivo} · {dinheiro(v.valor)} · venc. {dataBr(v.vencimento)}{' '}
                  <button type="button" className="link-button" style={{ fontSize: 12 }} onClick={() => abrir(v.arquivo_path)}>abrir</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {erro && <div className="error-text" style={{ marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
