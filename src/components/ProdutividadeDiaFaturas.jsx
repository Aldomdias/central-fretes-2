import React, { useEffect, useMemo, useState } from 'react';
import { carregarHistoricoProdutividade, carregarAutorizacoesProdutividade, carregarPendenciasAtuais, carregarEnviosErpPeriodo, carregarFaturasPorIds, carregarRemetentesAprovacaoGestao, carregarDecisoesAutorizacoesProdutividade } from '../services/auditoriaFretesService';

const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const FUSO = 'America/Sao_Paulo';

const LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO']);

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const partesNome = (nome) => semAcento(nome).split(/\s+/).filter(Boolean);
// O Verum grava "amd-log: Fulano" - tira o prefixo do sistema pra casar com o nome do usuario.
const limparNome = (nome) => String(nome || '').replace(/^\s*[\w.-]{1,30}:\s*/, '').trim();
const ehRobo = (nome) => semAcento(nome).startsWith('ROBO');
const ehDecisaoGestao = (e) => e.status_anterior === 'AGUARDANDO_APROVACAO_GESTAO' && e.status_novo !== 'AGUARDANDO_APROVACAO_GESTAO';

// Agrupa as variacoes de nome da mesma pessoa ("Caroline", "amd-log: Caroline de
// Quadro Waldhelm", nome completo) numa linha so, exibindo o nome mais completo.
function criarAgrupador(criarVazio) {
  const lista = [];
  const pessoa = (nomeBruto) => {
    const nome = limparNome(nomeBruto) || '(sem usuario)';
    let p = lista.find((x) => semAcento(x.nome) === semAcento(nome) || mesmaPessoa(nome, x.nome) || mesmaPessoa(x.nome, nome));
    if (!p) { p = { nome, ...criarVazio() }; lista.push(p); }
    else if (nome.length > p.nome.length) p.nome = nome;
    return p;
  };
  return { lista, pessoa };
}

// O Verum grava nome curto ("Deborah", "Abraao Ferreira") e o sistema o nome
// completo: casa pelo primeiro nome e, quando ha mais de um, tambem pelo ultimo.
function mesmaPessoa(nomeCurto, nomeCompleto) {
  const a = partesNome(nomeCurto);
  const b = partesNome(nomeCompleto);
  if (!a.length || !b.length) return false;
  if (a[0] !== b[0]) return false;
  return a.length === 1 || a[a.length - 1] === b[b.length - 1];
}

function hojeBrasilia() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
}

function somarDias(dia, n) {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

function intervalo(periodo) {
  const hoje = hojeBrasilia();
  if (periodo === 'ontem') return { inicio: somarDias(hoje, -1), fim: hoje };
  if (periodo === '7d') return { inicio: somarDias(hoje, -6), fim: somarDias(hoje, 1) };
  if (periodo === 'mes') return { inicio: `${hoje.slice(0, 7)}-01`, fim: somarDias(hoje, 1) };
  return { inicio: hoje, fim: somarDias(hoje, 1) };
}

// Controle de produtividade da Auditoria de fretes: quantas faturas cada pessoa
// auditou, liberou pra pagamento e enviou ao financeiro no periodo. Le do
// historico de eventos da fatura (quem fez + quando) - cada fatura conta uma
// vez por pessoa em cada coluna.
export default function ProdutividadeDiaFaturas({ compacto = false }) {
  const [periodo, setPeriodo] = useState('hoje');
  const [eventos, setEventos] = useState([]);
  const [autorizacoes, setAutorizacoes] = useState([]);
  const [enviosErp, setEnviosErp] = useState([]);
  const [remetentes, setRemetentes] = useState(new Map());
  const [decisoes, setDecisoes] = useState([]);
  const [pendencias, setPendencias] = useState({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [atualizadoEm, setAtualizadoEm] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      const { inicio, fim } = intervalo(periodo);
      // Meia-noite de Brasilia (UTC-3) do dia inicial/final.
      const ini = `${inicio}T00:00:00-03:00`;
      const fi = `${fim}T00:00:00-03:00`;
      const [ev, aut, pend, erp, dec] = await Promise.all([
        carregarHistoricoProdutividade(ini, fi),
        carregarAutorizacoesProdutividade(ini, fi),
        carregarPendenciasAtuais(),
        carregarEnviosErpPeriodo(ini, fi),
        carregarDecisoesAutorizacoesProdutividade(ini, fi),
      ]);
      // Liberacoes aprovadas pela gestao contam pra quem enviou pra aprovacao.
      const aprovadas = ev.filter((e) => ehDecisaoGestao(e) && LIBERADAS.has(e.status_novo)).map((e) => e.fatura_id);
      const rem = await carregarRemetentesAprovacaoGestao(aprovadas);
      setRemetentes(rem);
      setDecisoes(dec);
      setEventos(ev);
      setAutorizacoes(aut);
      setPendencias(pend);
      setEnviosErp(erp);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    // Atualiza sozinho a cada 2 minutos enquanto a tela esta aberta.
    const timer = setInterval(carregar, 120000);
    // Recarrega logo apos uma importacao de envios ao ERP e ao voltar para a aba.
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    window.addEventListener('envios-erp-atualizados', carregar);
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(timer);
      window.removeEventListener('envios-erp-atualizados', carregar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [periodo]);

  const CHAVES = ['auditadas', 'liberadas', 'aprovacao', 'enviadas', 'fornecedor', 'suprimentos', 'transporte', 'erp'];
  const CHAVES_APROV = ['gestaoAprovadas', 'gestaoDevolvidas', 'b2cAutorizadas', 'atacadoAutorizadas', 'suprimentosAutorizadas', 'recusadas'];
  const vazio = (chaves) => () => Object.fromEntries(chaves.map((k) => [k, new Set()]));
  const fechar = (lista, chaves, soma) => lista
    .map((p) => ({ nome: p.nome, ids: Object.fromEntries(chaves.map((k) => [k, [...p[k]]])), ...Object.fromEntries(chaves.map((k) => [k, p[k].size])) }))
    .filter((l) => chaves.some((k) => l[k] > 0))
    .sort((a, b) => soma(b) - soma(a));

  const { linhas, linhasAprov } = useMemo(() => {
    const aud = criarAgrupador(vazio(CHAVES));
    const apr = criarAgrupador(vazio(CHAVES_APROV));
    for (const e of eventos) {
      if (ehDecisaoGestao(e)) {
        // Decisao da gestao: vai pro quadro de aprovacoes, nao pra produtividade de auditoria.
        if (LIBERADAS.has(e.status_novo)) {
          apr.pessoa(e.usuario_nome).gestaoAprovadas.add(e.fatura_id);
          const quemEnviou = remetentes.get(e.fatura_id);
          if (quemEnviou) aud.pessoa(quemEnviou).liberadas.add(e.fatura_id);
        } else if (!ehRobo(e.usuario_nome)) {
          apr.pessoa(e.usuario_nome).gestaoDevolvidas.add(e.fatura_id);
        }
        continue;
      }
      const p = aud.pessoa(e.usuario_nome);
      if (LIBERADAS.has(e.status_novo)) { p.liberadas.add(e.fatura_id); p.auditadas.add(e.fatura_id); }
      else if (e.status_novo === 'AGUARDANDO_APROVACAO_GESTAO') { p.aprovacao.add(e.fatura_id); p.auditadas.add(e.fatura_id); }
      else if (e.status_novo === 'ENVIADA_AO_FINANCEIRO') p.enviadas.add(e.fatura_id);
      else if (e.status_novo === 'AGUARDANDO_TRANSPORTADORA') p.fornecedor.add(e.fatura_id);
      else if (e.acao === 'REAUDITORIA_CONCLUIDA') p.auditadas.add(e.fatura_id);
    }
    for (const f of enviosErp) aud.pessoa(f.enviado_por).erp.add(f.id);
    for (const a of autorizacoes) {
      const p = aud.pessoa(a.enviado_por);
      const id = a.fatura_id || a.id;
      if (a.canal === 'SUPRIMENTOS') p.suprimentos.add(id);
      else p.transporte.add(id);
    }
    for (const d of decisoes) {
      const p = apr.pessoa(d.decidido_por);
      const id = d.fatura_id || d.id;
      if (d.status === 'RECUSADA') p.recusadas.add(id);
      else if (d.canal === 'SUPRIMENTOS') p.suprimentosAutorizadas.add(id);
      else if (d.canal === 'ATACADO') p.atacadoAutorizadas.add(id);
      else p.b2cAutorizadas.add(id);
    }
    return {
      linhas: fechar(aud.lista, CHAVES, (l) => l.auditadas + l.enviadas + l.erp + l.liberadas),
      linhasAprov: fechar(apr.lista, CHAVES_APROV, (l) => CHAVES_APROV.reduce((t, k) => t + l[k], 0)),
    };
  }, [eventos, autorizacoes, enviosErp, remetentes, decisoes]);

  const total = linhas.reduce((t, l) => ({
    auditadas: t.auditadas + l.auditadas,
    liberadas: t.liberadas + l.liberadas,
    aprovacao: t.aprovacao + l.aprovacao,
    enviadas: t.enviadas + l.enviadas,
    fornecedor: t.fornecedor + l.fornecedor,
    suprimentos: t.suprimentos + l.suprimentos,
    transporte: t.transporte + l.transporte,
    erp: t.erp + l.erp,
  }), { auditadas: 0, liberadas: 0, aprovacao: 0, enviadas: 0, fornecedor: 0, suprimentos: 0, transporte: 0, erp: 0 });

  const [detalhe, setDetalhe] = useState(null);

  const abrirDetalhe = async (pessoa, coluna, ids) => {
    if (!ids.length) return;
    setDetalhe({ pessoa, coluna, itens: [], carregando: true, erro: '', total: ids.length });
    try {
      const faturas = await carregarFaturasPorIds(ids);
      const mapa = new Map(faturas.map((f) => [f.id, f]));
      const itens = ids.map((id) => mapa.get(id) || { id, numero_fatura: '(nao encontrada)' });
      setDetalhe({ pessoa, coluna, itens, carregando: false, erro: '', total: ids.length });
    } catch (e) {
      setDetalhe({ pessoa, coluna, itens: [], carregando: false, erro: e.message || String(e), total: ids.length });
    }
  };

  const celula = (pessoa, coluna, chave, ids, valor, forte) => {
    const conteudo = forte ? <strong>{inteiro(valor)}</strong> : inteiro(valor);
    return (
      <td style={{ textAlign: 'right' }}>
        {valor > 0 ? (
          <button type="button" title="Ver faturas" onClick={() => abrirDetalhe(pessoa, coluna, ids)}
            style={{ background: 'none', border: 0, padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
            {conteudo}
          </button>
        ) : conteudo}
      </td>
    );
  };

  const colunas = [
    ['auditadas', 'Auditadas', true], ['liberadas', 'Liberadas p/ pagamento'], ['aprovacao', 'Enviadas p/ aprovacao gestao'],
    ['erp', 'Enviadas ao ERP'], ['enviadas', 'Enviadas ao financeiro'], ['fornecedor', 'Enviadas ao fornecedor'],
    ['suprimentos', 'Enviadas p/ Suprimentos'], ['transporte', 'Enviadas p/ Transporte'],
  ];
  const idsTotal = (chave, base = linhas) => [...new Set(base.flatMap((l) => l.ids[chave]))];
  const colunasAprov = [
    ['gestaoAprovadas', 'Aprovadas pela gestao'], ['gestaoDevolvidas', 'Devolvidas pela gestao'],
    ['b2cAutorizadas', 'Autorizadas Transporte B2C'], ['atacadoAutorizadas', 'Autorizadas Transporte Atacado'],
    ['suprimentosAutorizadas', 'Autorizadas Suprimentos'], ['recusadas', 'Recusadas (Transp./Supr.)'],
  ];
  const totalAprov = Object.fromEntries(CHAVES_APROV.map((k) => [k, idsTotal(k, linhasAprov).length]));

  const rotulo = { hoje: 'Hoje', ontem: 'Ontem', '7d': 'Ultimos 7 dias', mes: 'Mes atual' }[periodo];

  return (
    <div className="table-card" style={compacto ? { marginBottom: 12 } : undefined}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ margin: 0 }}>Produtividade da auditoria de faturas - {rotulo}</h4>
          <small>
            Auditadas = liberadas para pagamento + enviadas para aprovacao da gestao + reauditorias concluidas.
            Liberacao aprovada pela gestao conta para quem enviou a fatura para aprovacao; as decisoes de gestao, Transporte e Suprimentos ficam no quadro de aprovacoes abaixo.
            {atualizadoEm ? ` Atualizado as ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : ''}
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="hoje">Hoje</option>
            <option value="ontem">Ontem</option>
            <option value="7d">Ultimos 7 dias</option>
            <option value="mes">Mes atual</option>
          </select>
          <button type="button" className="btn-secondary" disabled={carregando} onClick={carregar}>{carregando ? 'Atualizando...' : '↻ Atualizar'}</button>
        </div>
      </div>
      {erro ? <div className="sim-alert error" style={{ marginTop: 8 }}>{erro}</div> : null}
      <div className="summary-strip" style={{ marginTop: 10 }}>
        <div className="summary-card"><span>Aguardando o fornecedor (agora)</span><strong>{pendencias.fornecedor == null ? '-' : inteiro(pendencias.fornecedor)}</strong></div>
        <div className="summary-card"><span>Aguardando aprovacao da gestao (agora)</span><strong>{pendencias.gestao == null ? '-' : inteiro(pendencias.gestao)}</strong></div>
        <div className="summary-card"><span>Aguardando Suprimentos (agora)</span><strong>{pendencias.suprimentos == null ? '-' : inteiro(pendencias.suprimentos)}</strong></div>
        <div className="summary-card"><span>Aguardando o Transporte (agora)</span><strong>{pendencias.transporte == null ? '-' : inteiro(pendencias.transporte)}</strong></div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th style={{ textAlign: 'right' }}>Auditadas</th>
              <th style={{ textAlign: 'right' }}>Liberadas p/ pagamento</th>
              <th style={{ textAlign: 'right' }}>Enviadas p/ aprovacao gestao</th>
              <th style={{ textAlign: 'right' }}>Enviadas ao ERP</th>
              <th style={{ textAlign: 'right' }}>Enviadas ao financeiro</th>
              <th style={{ textAlign: 'right' }}>Enviadas ao fornecedor</th>
              <th style={{ textAlign: 'right' }}>Enviadas p/ Suprimentos</th>
              <th style={{ textAlign: 'right' }}>Enviadas p/ Transporte</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.nome}>
                <td>{l.nome}</td>
                {colunas.map(([k, rot, forte]) => <React.Fragment key={k}>{celula(l.nome, rot, k, l.ids[k], l[k], forte)}</React.Fragment>)}
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan={9} style={{ color: '#64748b' }}>{carregando ? 'Carregando...' : 'Nenhuma movimentacao no periodo.'}</td></tr> : null}
            {linhas.length ? (
              <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                <td>Total</td>
                {colunas.map(([k, rot]) => <React.Fragment key={k}>{celula('Total', rot, k, idsTotal(k), total[k])}</React.Fragment>)}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <h4 style={{ margin: '16px 0 4px' }}>Aprovacoes - gestao, Transporte e Suprimentos - {rotulo}</h4>
      <small>Quem decidiu (aprovou, devolveu, autorizou ou recusou) no periodo. Nao entra na produtividade da auditoria.</small>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              {colunasAprov.map(([k, rot]) => <th key={k} style={{ textAlign: 'right' }}>{rot}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhasAprov.map((l) => (
              <tr key={l.nome}>
                <td>{l.nome}</td>
                {colunasAprov.map(([k, rot]) => <React.Fragment key={k}>{celula(l.nome, rot, k, l.ids[k], l[k])}</React.Fragment>)}
              </tr>
            ))}
            {!linhasAprov.length ? <tr><td colSpan={colunasAprov.length + 1} style={{ color: '#64748b' }}>{carregando ? 'Carregando...' : 'Nenhuma aprovacao no periodo.'}</td></tr> : null}
            {linhasAprov.length ? (
              <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                <td>Total</td>
                {colunasAprov.map(([k, rot]) => <React.Fragment key={k}>{celula('Total', rot, k, idsTotal(k, linhasAprov), totalAprov[k])}</React.Fragment>)}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {detalhe ? (
        <div onClick={() => setDetalhe(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 16, width: 'min(820px, 100%)', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{detalhe.pessoa} - {detalhe.coluna} ({inteiro(detalhe.total)}) - {rotulo}</h4>
              <button type="button" className="btn-secondary" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
            {detalhe.erro ? <div className="sim-alert error" style={{ marginTop: 8 }}>{detalhe.erro}</div> : null}
            {detalhe.carregando ? <p>Carregando...</p> : (
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>Fatura</th><th>Transportadora</th><th>Status atual</th><th style={{ textAlign: 'right' }}>Valor</th><th>Vencimento</th></tr>
                </thead>
                <tbody>
                  {detalhe.itens.map((f) => (
                    <tr key={f.id}>
                      <td>{f.numero_fatura}{f.serie_fatura ? `-${f.serie_fatura}` : ''}</td>
                      <td>{f.transportadora || '-'}</td>
                      <td>{f.status || '-'}</td>
                      <td style={{ textAlign: 'right' }}>{f.valor_fatura == null ? '-' : Number(f.valor_fatura).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      <td>{f.data_vencimento ? String(f.data_vencimento).slice(0, 10).split('-').reverse().join('/') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
