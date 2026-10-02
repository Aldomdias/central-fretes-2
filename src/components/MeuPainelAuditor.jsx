import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import CtesSemFaturaPainel from './CtesSemFaturaPainel';
import { listarProtocolosComDesconto } from '../services/descontosObtidosService';
import { listarAguardandoNovaFaturaAbertos } from '../services/baixaEntregaService';
import { buscarStatusEntregaCtes, chaveEntregaRegistro, STATUS_ENTREGA } from '../services/auditoriaEntregaCteService';
import { carregarSessao, usuarioEhGestorAuditoria } from '../utils/authLocal';
import { diasAte, ENCERRADOS } from '../utils/auditoriaFretesDomain';
import {
  carregarAutorizacoesPendentes, carregarDesdeStatusAtual, excluirDemanda, listarDemandas, salvarDemanda,
} from '../services/auditoriaDemandasService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const STATUS_AUDITAR = new Set(['RECEBIDA', 'PRE_AUDITADA_VERUM', 'REAUDITADA_CENTRAL', 'COM_DIVERGENCIA']);
const STATUS_LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO', 'PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA']);
const FORA_DA_FILA = new Set([...ENCERRADOS, 'PAGA_COM_DESCONTO', 'TRATADA']);
const ROTULO_STATUS = {
  RECEBIDA: 'Recebida', PRE_AUDITADA_VERUM: 'Pre-auditada Verum', REAUDITADA_CENTRAL: 'Reauditada', COM_DIVERGENCIA: 'Com divergencia',
  AGUARDANDO_TRANSPORTADORA: 'Aguardando fornecedor', AGUARDANDO_NOVA_FATURA: 'Aguardando nova fatura',
  AGUARDANDO_APROVACAO_GESTAO: 'Aguardando gestao', PRONTA_PARA_PAGAMENTO: 'Liberada p/ pagamento',
  LIBERADA_COM_DESCONTO: 'Liberada com desconto', ENVIADA_AO_FINANCEIRO: 'No financeiro',
};

const ETAPAS = [
  { id: 'auditar', rotulo: 'Para auditar', cor: '#1d4ed8', dica: 'Recebidas, pre-auditadas ou com divergencia: falta voce auditar e liberar.' },
  { id: 'fornecedor', rotulo: 'Aguardando fornecedor', cor: '#e67e22', dica: 'Laudo enviado, esperando retorno da transportadora.' },
  { id: 'novaFatura', rotulo: 'Aguardando nova fatura', cor: '#b45309', dica: 'Fornecedor precisa reemitir a fatura.' },
  { id: 'gestao', rotulo: 'Aguardando gestao', cor: '#9153F0', dica: 'Enviadas para aprovacao da gestao.' },
  { id: 'suprimentos', rotulo: 'Aguardando Suprimentos', cor: '#0e7490', dica: 'Ajuste de tabela pedido a Suprimentos (autorizacao pendente).' },
  { id: 'transporte', rotulo: 'Aguardando Transporte', cor: '#0f766e', dica: 'Autorizacao pendente com o gestor do Transporte (B2C/Atacado).' },
  { id: 'liberadas', rotulo: 'Liberadas p/ pagamento', cor: '#14733b', dica: 'Liberadas, ainda nao enviadas ao financeiro.' },
  { id: 'financeiro', rotulo: 'No financeiro', cor: '#475569', dica: 'Ja enviadas ao financeiro.' },
  { id: 'erpSemLiberacao', rotulo: 'ERP sem liberacao', cor: '#b91c1c', dica: 'Enviadas ao ERP sem estar liberadas para pagamento. Precisam ser liberadas ou passar pela gestao.' },
];

const FAIXAS = [
  { id: 'vencidas', rotulo: 'Vencidas', cor: '#b91c1c', ok: (d) => d < 0 },
  { id: 'hoje', rotulo: 'Hoje / amanha', cor: '#c2410c', ok: (d) => d >= 0 && d <= 1 },
  { id: 'ate3', rotulo: '2 a 3 dias', cor: '#b45309', ok: (d) => d >= 2 && d <= 3 },
  { id: 'ate7', rotulo: '4 a 7 dias', cor: '#a16207', ok: (d) => d >= 4 && d <= 7 },
  { id: 'mais7', rotulo: 'Mais de 7 dias', cor: '#475569', ok: (d) => d >= 8 },
];

const cartao = (ativo, cor) => ({
  textAlign: 'left', cursor: 'pointer', background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
  border: `2px solid ${ativo ? cor : '#e2e8f0'}`, borderRadius: 12, padding: '10px 14px', minWidth: 150, flex: '1 1 150px',
});

function dentroDaEtapa(etapa, f, ctx) {
  switch (etapa) {
    case 'auditar': return STATUS_AUDITAR.has(f.status) && f.confirmacao_transportador_status !== 'ENVIADO';
    case 'fornecedor': return f.status === 'AGUARDANDO_TRANSPORTADORA' || f.confirmacao_transportador_status === 'ENVIADO';
    case 'novaFatura': return f.status === 'AGUARDANDO_NOVA_FATURA';
    case 'gestao': return f.status === 'AGUARDANDO_APROVACAO_GESTAO';
    case 'suprimentos': return ctx.suprimentos.has(String(f.id));
    case 'transporte': return ctx.transporte.has(String(f.id));
    case 'liberadas': return f.status === 'PRONTA_PARA_PAGAMENTO' || f.status === 'LIBERADA_COM_DESCONTO';
    case 'financeiro': return f.status === 'ENVIADA_AO_FINANCEIRO';
    case 'erpSemLiberacao': return Boolean(f.data_envio_erp) && !STATUS_LIBERADAS.has(f.status);
    default: return true;
  }
}

const chaveFatura = (numero, transportadora) => `${String(numero || '').trim().toUpperCase().replace(/^0+(?=.)/, '')}::${norm(transportadora).replace(/[^a-z0-9]+/g, ' ').trim()}`;
const mesAtual = () => new Date().toISOString().slice(0, 7);

function diasDesde(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export default function MeuPainelAuditor({ state, onAbrirFatura }) {
  const sessao = carregarSessao();
  const gestor = usuarioEhGestorAuditoria(sessao);
  const meuEmail = norm(sessao?.email);
  const meuNome = norm(sessao?.nome);
  const eMinha = (f) => (!!meuEmail && norm(f.auditor_email) === meuEmail) || (!!meuNome && norm(f.auditor_nome) === meuNome);

  const abertas = useMemo(() => (state.faturas || []).filter((f) => !FORA_DA_FILA.has(f.status)), [state.faturas]);
  const auditores = useMemo(() => [...new Set(abertas.map((f) => f.auditor_nome || 'SEM AUDITOR'))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [abertas]);
  const temMinhas = useMemo(() => abertas.some(eMinha), [abertas, meuEmail, meuNome]);

  const [auditorSel, setAuditorSel] = useState(() => (gestor ? '' : 'MINHAS'));
  const [etapa, setEtapa] = useState('');
  const [faixa, setFaixa] = useState('');
  const [busca, setBusca] = useState('');
  const [autorizacoes, setAutorizacoes] = useState([]);
  const [desde, setDesde] = useState({});
  const [demandas, setDemandas] = useState([]);
  const [demandasLocais, setDemandasLocais] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState('');
  const [form, setForm] = useState({ titulo: '', numero: '', prazo: '', observacao: '' });
  const tituloRef = useRef(null);
  const [mesDesconto, setMesDesconto] = useState(mesAtual);
  const [protocolos, setProtocolos] = useState(null);
  useEffect(() => { listarProtocolosComDesconto().then(setProtocolos).catch(() => setProtocolos([])); }, []);
  const [ctesAguardando, setCtesAguardando] = useState(null);
  const [verCtesAguardando, setVerCtesAguardando] = useState(false);
  useEffect(() => { listarAguardandoNovaFaturaAbertos().then(setCtesAguardando); }, []);

  // Gestor que tambem e auditor abre ja no proprio recorte.
  useEffect(() => { if (gestor && temMinhas) setAuditorSel((atual) => atual || 'MINHAS'); }, [gestor, temMinhas]);

  const doAuditor = useMemo(() => abertas.filter((f) => {
    if (auditorSel === 'MINHAS') return eMinha(f);
    if (auditorSel) return (f.auditor_nome || 'SEM AUDITOR') === auditorSel;
    return true;
  }), [abertas, auditorSel, meuEmail, meuNome]);

  useEffect(() => { carregarAutorizacoesPendentes().then(setAutorizacoes); }, []);
  const recarregarDemandas = () => listarDemandas().then(({ lista, local }) => { setDemandas(lista); setDemandasLocais(local); }).catch((e) => setErro(e.message));
  useEffect(() => { recarregarDemandas(); }, []);

  const chaveDesde = doAuditor.length <= 800 ? doAuditor.map((f) => `${f.id}:${f.status}`).join('|') : '';
  useEffect(() => {
    if (!chaveDesde) { setDesde({}); return undefined; }
    let ativo = true;
    carregarDesdeStatusAtual(doAuditor).then((mapa) => { if (ativo) setDesde(mapa); });
    return () => { ativo = false; };
  }, [chaveDesde]);

  const ctx = useMemo(() => {
    const ids = new Set(doAuditor.map((f) => String(f.id)));
    const suprimentos = new Set();
    const transporte = new Set();
    let semFaturaSup = 0;
    let semFaturaTrans = 0;
    const meu = (a) => auditorSel === 'MINHAS' ? (!!meuNome && norm(a.enviado_por) === meuNome) : false;
    autorizacoes.forEach((a) => {
      const alvo = a.canal === 'SUPRIMENTOS' ? suprimentos : transporte;
      if (a.fatura_id && ids.has(String(a.fatura_id))) alvo.add(String(a.fatura_id));
      else if (!a.fatura_id && meu(a)) { if (a.canal === 'SUPRIMENTOS') semFaturaSup += 1; else semFaturaTrans += 1; }
    });
    return { suprimentos, transporte, semFaturaSup, semFaturaTrans };
  }, [autorizacoes, doAuditor, auditorSel, meuNome]);

  const faturasComDemanda = useMemo(() => {
    const mapa = new Map();
    demandas.filter((d) => d.status !== 'CONCLUIDA' && d.fatura_id).forEach((d) => mapa.set(String(d.fatura_id), (mapa.get(String(d.fatura_id)) || 0) + 1));
    return mapa;
  }, [demandas]);

  // Desconto confirmado = protocolos com desconto enviados ao financeiro no mes, atribuidos ao auditor da fatura.
  const descontoMes = useMemo(() => {
    const donoPorChave = new Map();
    (state.faturas || []).forEach((f) => donoPorChave.set(chaveFatura(f.numero_fatura, f.transportadora), f));
    const porAuditor = new Map();
    let total = 0;
    let qtd = 0;
    (protocolos || []).forEach((p) => {
      if (String(p.enviado_em || p.created_at || '').slice(0, 7) !== mesDesconto) return;
      const f = donoPorChave.get(chaveFatura(p.numero_fatura, p.transportadora));
      const nome = f?.auditor_nome || 'SEM AUDITOR';
      const meu = f && ((!!meuEmail && norm(f.auditor_email) === meuEmail) || (!!meuNome && norm(f.auditor_nome) === meuNome));
      const entra = auditorSel === 'MINHAS' ? meu : auditorSel ? nome === auditorSel : true;
      const valor = Number(p.desconto_total || 0);
      const r = porAuditor.get(nome) || { nome, valor: 0 };
      r.valor += valor;
      porAuditor.set(nome, r);
      if (entra) { total += valor; qtd += 1; }
    });
    return { total, qtd, porAuditor };
  }, [protocolos, state.faturas, mesDesconto, auditorSel, meuEmail, meuNome]);
  const descontoEmAprovacao = doAuditor
    .filter((f) => f.status === 'AGUARDANDO_APROVACAO_GESTAO')
    .reduce((acc, f) => acc + Number(f.desconto_pendente_valor || f.auditoria_total_descontar || 0), 0);

  // CT-es retirados de fatura por falta de entrega e ainda sem fatura nova, do recorte do auditor.
  const aguardandoCtes = useMemo(() => {
    const donas = new Set((state.faturas || []).filter((f) => {
      if (auditorSel === 'MINHAS') return eMinha(f);
      if (auditorSel) return (f.auditor_nome || 'SEM AUDITOR') === auditorSel;
      return true;
    }).map((f) => String(f.id)));
    const linhas = (ctesAguardando || []).filter((r) => donas.has(String(r.fatura_origem_id)));
    const valor = linhas.reduce((acc, r) => acc + Number(r.valor_cte || 0), 0);
    const porFatura = new Map();
    linhas.forEach((r) => {
      const k = `${r.numero_fatura_origem || '-'}::${r.transportadora || '-'}`;
      const g = porFatura.get(k) || { fatura: r.numero_fatura_origem, transportadora: r.transportadora, qtd: 0, valor: 0, desde: r.criado_em };
      g.qtd += 1; g.valor += Number(r.valor_cte || 0);
      if (r.criado_em && (!g.desde || r.criado_em < g.desde)) g.desde = r.criado_em;
      porFatura.set(k, g);
    });
    return { qtd: linhas.length, valor, linhas, grupos: [...porFatura.values()].sort((a, b) => String(a.desde).localeCompare(String(b.desde))) };
  }, [ctesAguardando, state.faturas, auditorSel, meuEmail, meuNome]);
  const [buscaAguardando, setBuscaAguardando] = useState('');
  const [entregaAguardando, setEntregaAguardando] = useState(null);
  useEffect(() => {
    if (!verCtesAguardando || !ctesAguardando?.length) return undefined;
    let ativo = true;
    setEntregaAguardando(null);
    buscarStatusEntregaCtes(ctesAguardando.map((r) => ({ chave_cte: r.chave, numero_cte: r.numero_cte })))
      .then((m) => { if (ativo) setEntregaAguardando(m); })
      .catch(() => { if (ativo) setEntregaAguardando(new Map()); });
    return () => { ativo = false; };
  }, [verCtesAguardando, ctesAguardando]);
  const exportarAguardando = () => {
    const linhas = linhasAguardando.map((r) => {
      const fat = faturaPorId.get(String(r.fatura_origem_id));
      return {
        'CT-e': r.numero_cte || '',
        'Chave do CT-e': String(r.chave || '').length >= 44 ? String(r.chave) : '',
        'Transportadora': r.transportadora || fat?.transportadora || '',
        'Fatura de origem': r.numero_fatura_origem || '',
        'Status da fatura de origem': fat ? (ROTULO_STATUS[fat.status] || fat.status) : '',
        'Situacao do CT-e': 'Aguardando nova fatura',
        'Entrega': rotuloEntrega(r).texto,
        'Valor': Number(r.valor_cte || 0),
        'Retirado em': dataBr(r.criado_em),
        'Dias': diasDesde(r.criado_em) ?? '',
        'Retirado por': r.criado_por || '',
        'Motivo': r.motivo || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    // Chave de 44 digitos como texto, para o Excel nao virar notacao cientifica.
    ws['!cols'] = [{ wch: 10 }, { wch: 48 }, { wch: 26 }, { wch: 14 }, { wch: 24 }, { wch: 22 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Aguardando nova fatura');
    XLSX.writeFile(wb, `CTES_AGUARDANDO_NOVA_FATURA_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const rotuloEntrega = (r) => {
    if (!entregaAguardando) return { texto: 'Consultando...', cor: '#64748b' };
    const e = entregaAguardando.get(chaveEntregaRegistro({ chave_cte: r.chave, numero_cte: r.numero_cte }));
    if (e?.status === STATUS_ENTREGA.ENTREGUE) return { texto: `Entregue${e.dataEntrega ? ` em ${dataBr(e.dataEntrega)}` : ''}`, cor: '#14733b' };
    if (e?.status === STATUS_ENTREGA.NAO_ENTREGUE) return { texto: 'Sem entrega (no tracking)', cor: '#b91c1c' };
    return { texto: 'Sem tracking', cor: '#64748b' };
  };
  const faturaPorId = useMemo(() => new Map((state.faturas || []).map((f) => [String(f.id), f])), [state.faturas]);
  const linhasAguardando = useMemo(() => {
    const termo = norm(buscaAguardando);
    return aguardandoCtes.linhas
      .filter((r) => !termo || [r.numero_cte, r.chave, r.numero_fatura_origem, r.transportadora].some((v) => norm(v).includes(termo)))
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  }, [aguardandoCtes, buscaAguardando]);

  const contagemEtapa =(id) => doAuditor.filter((f) => dentroDaEtapa(id, f, ctx)).length;
  const contagemFaixa = (fx) => doAuditor.filter((f) => { const d = diasAte(f.data_vencimento); return d != null && fx.ok(d); }).length;

  const lista = useMemo(() => {
    const termo = norm(busca);
    return doAuditor
      .filter((f) => !etapa || dentroDaEtapa(etapa, f, ctx))
      .filter((f) => {
        if (!faixa) return true;
        const d = diasAte(f.data_vencimento);
        return d != null && FAIXAS.find((x) => x.id === faixa).ok(d);
      })
      .filter((f) => !termo || [f.numero_fatura, f.transportadora, f.auditor_nome].some((v) => norm(v).includes(termo)))
      .sort((a, b) => (diasAte(a.data_vencimento) ?? 9999) - (diasAte(b.data_vencimento) ?? 9999));
  }, [doAuditor, etapa, faixa, busca, ctx]);

  const valorLista = lista.reduce((acc, f) => acc + Number(f.valor_fatura || 0), 0);
  const mostrarAuditorCol = !auditorSel || auditorSel !== 'MINHAS';

  const resumoPorAuditor = useMemo(() => {
    if (auditorSel) return [];
    const mapa = new Map();
    abertas.forEach((f) => {
      const nome = f.auditor_nome || 'SEM AUDITOR';
      const r = mapa.get(nome) || { nome, abertas: 0, vencidas: 0, auditar: 0, fornecedor: 0, gestao: 0, erp: 0 };
      r.abertas += 1;
      const d = diasAte(f.data_vencimento);
      if (d != null && d < 0) r.vencidas += 1;
      if (dentroDaEtapa('auditar', f, ctx)) r.auditar += 1;
      if (dentroDaEtapa('fornecedor', f, ctx)) r.fornecedor += 1;
      if (dentroDaEtapa('gestao', f, ctx)) r.gestao += 1;
      if (dentroDaEtapa('erpSemLiberacao', f, ctx)) r.erp += 1;
      mapa.set(nome, r);
    });
    return [...mapa.values()].sort((a, b) => b.erp - a.erp || b.vencidas - a.vencidas || b.abertas - a.abertas);
  }, [abertas, auditorSel, ctx]);

  const diasParado = (f) => {
    if (f.confirmacao_transportador_status === 'ENVIADO' && f.confirmacao_transportador_enviado_em) return diasDesde(f.confirmacao_transportador_enviado_em);
    return diasDesde(desde[f.id] || f.updated_at);
  };

  const etapaDe = (f) => {
    if (dentroDaEtapa('erpSemLiberacao', f, ctx)) return { texto: f.status === 'AGUARDANDO_APROVACAO_GESTAO' ? 'ERP enviado — aguardando gestao' : 'ERP enviado sem liberar', cor: '#b91c1c' };
    return { texto: ROTULO_STATUS[f.status] || f.status, cor: '#334155' };
  };

  const mensagemAviso = (f) => {
    const quem = f.auditor_nome || 'auditor';
    const regra = f.status === 'AGUARDANDO_APROVACAO_GESTAO'
      ? 'ela esta aguardando a decisao da gestao'
      : 'ela nao esta liberada para pagamento — libere, ou envie para a aprovacao da gestao se houver cobranca a maior';
    return `Ola ${quem}, a fatura ${f.numero_fatura} (${f.transportadora}) ja foi enviada ao ERP, mas ${regra}. O envio ao ERP so pode acontecer com a fatura liberada para pagamento.`;
  };
  const copiarAviso = async (f) => {
    try { await navigator.clipboard.writeText(mensagemAviso(f)); setCopiado(String(f.id)); setTimeout(() => setCopiado(''), 2500); } catch { window.prompt('Copie o aviso:', mensagemAviso(f)); }
  };

  const donoDemanda = () => {
    const alvo = auditorSel && auditorSel !== 'MINHAS' ? abertas.find((f) => (f.auditor_nome || 'SEM AUDITOR') === auditorSel) : null;
    return alvo ? { nome: alvo.auditor_nome || '', email: alvo.auditor_email || '' } : { nome: sessao?.nome || '', email: sessao?.email || '' };
  };
  const minhasDemandas = useMemo(() => demandas.filter((d) => {
    if (auditorSel === 'MINHAS' || (!gestor && !auditorSel)) return (!!meuEmail && norm(d.auditor_email) === meuEmail) || (!!meuNome && norm(d.auditor_nome) === meuNome);
    if (auditorSel) return norm(d.auditor_nome) === norm(auditorSel);
    return true;
  }), [demandas, auditorSel, gestor, meuEmail, meuNome]);
  const abertasDemandas = minhasDemandas.filter((d) => d.status !== 'CONCLUIDA')
    .sort((a, b) => String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')));
  const concluidasDemandas = minhasDemandas.filter((d) => d.status === 'CONCLUIDA').slice(0, 10);
  const hojeIso = new Date().toISOString().slice(0, 10);
  const demandasHoje = abertasDemandas.filter((d) => d.prazo && d.prazo <= hojeIso).length;

  const adicionarDemanda = async () => {
    if (!form.titulo.trim()) { setErro('Descreva a demanda.'); return; }
    setErro('');
    const fat = form.numero.trim() ? (state.faturas || []).find((f) => String(f.numero_fatura).trim() === form.numero.trim()) : null;
    if (form.numero.trim() && !fat) { setErro(`Fatura ${form.numero.trim()} nao encontrada.`); return; }
    const dono = donoDemanda();
    try {
      await salvarDemanda({
        auditor_nome: dono.nome, auditor_email: dono.email, fatura_id: fat ? String(fat.id) : null,
        numero_fatura: fat?.numero_fatura || null, transportadora: fat?.transportadora || null,
        titulo: form.titulo.trim(), observacao: form.observacao.trim() || null, prazo: form.prazo || null,
        status: 'ABERTA', criado_por: sessao?.nome || sessao?.email || '',
      });
      setForm({ titulo: '', numero: '', prazo: '', observacao: '' });
      recarregarDemandas();
    } catch (e) { setErro(e.message); }
  };
  const alternarConclusao = async (d) => {
    const concluir = d.status !== 'CONCLUIDA';
    try {
      await salvarDemanda({ ...d, status: concluir ? 'CONCLUIDA' : 'ABERTA', concluida_em: concluir ? new Date().toISOString() : null });
      recarregarDemandas();
    } catch (e) { setErro(e.message); }
  };
  const removerDemanda = async (d) => {
    if (!window.confirm(`Excluir a demanda "${d.titulo}"?`)) return;
    try { await excluirDemanda(d.id); recarregarDemandas(); } catch (e) { setErro(e.message); }
  };
  const anotarFatura = (f) => {
    setForm((p) => ({ ...p, numero: String(f.numero_fatura || ''), titulo: p.titulo || `Fatura ${f.numero_fatura}: ` }));
    setTimeout(() => tituloRef.current?.focus(), 50);
  };

  const filtroAtivo = etapa || faixa || busca;
  const vazioMinhas = auditorSel === 'MINHAS' && !temMinhas;

  return (
    <div>
      <div className="table-card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div className="panel-title audit-table-title" style={{ marginBottom: 2 }}>Meu painel</div>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              {gestor && !auditorSel ? 'Visao da gestao: todos os auditores.' : `Faturas em aberto de ${auditorSel && auditorSel !== 'MINHAS' ? auditorSel : (sessao?.nome || 'voce')}.`}
              {' '}Clique nos cards para filtrar a lista; clique de novo para limpar.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {gestor && (
              <label className="field" style={{ minWidth: 220 }}>Auditor
                <select value={auditorSel} onChange={(e) => { setAuditorSel(e.target.value); setEtapa(''); setFaixa(''); }}>
                  <option value="">Todos (visao da gestao)</option>
                  {temMinhas && <option value="MINHAS">Minhas faturas</option>}
                  {auditores.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
                </select>
              </label>
            )}
            <label className="field" style={{ minWidth: 200 }}>Buscar
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fatura ou transportadora" />
            </label>
            {filtroAtivo && <button type="button" className="btn-secondary" onClick={() => { setEtapa(''); setFaixa(''); setBusca(''); }}>Limpar filtros</button>}
          </div>
        </div>
      </div>

      {vazioMinhas && (
        <div className="hint-box compact">Nenhuma fatura em aberto esta atribuida ao seu usuario ({sessao?.nome || sessao?.email}). A atribuicao e feita na carteira de transportadoras.</div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 12 }}>
        <div style={{ flex: '1 1 220px', border: '2px solid #14733b', borderRadius: 12, padding: '10px 14px', background: '#f0fdf4' }}>
          <div style={{ fontSize: 12, color: '#475569', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            Desconto confirmado no mes
            <input type="month" value={mesDesconto} onChange={(e) => setMesDesconto(e.target.value || mesAtual())} style={{ fontSize: 12 }} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#14733b' }}>{protocolos == null ? '...' : dinheiro(descontoMes.total)}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{descontoMes.qtd} fatura(s) com desconto enviadas ao financeiro</div>
        </div>
        <div style={{ flex: '1 1 220px', border: '2px solid #9153F0', borderRadius: 12, padding: '10px 14px', background: '#faf5ff' }}>
          <div style={{ fontSize: 12, color: '#475569' }}>Desconto aguardando a gestao</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#7c3aed' }}>{dinheiro(descontoEmAprovacao)}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>ainda nao confirmado — depende da decisao da gestao</div>
        </div>
        <div style={{ flex: '1 1 220px', border: '2px solid #b45309', borderRadius: 12, padding: '10px 14px', background: '#fffbeb', cursor: aguardandoCtes.qtd ? 'pointer' : 'default' }} onClick={() => aguardandoCtes.qtd && setVerCtesAguardando((v) => !v)} title="CT-es retirados da fatura por falta de entrega, esperando entrar em fatura nova (saem sozinhos da lista quando entram)">
          <div style={{ fontSize: 12, color: '#475569' }}>CT-es aguardando nova fatura</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#b45309' }}>{ctesAguardando == null ? '...' : aguardandoCtes.qtd}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{ctesAguardando == null ? '' : `${dinheiro(aguardandoCtes.valor)} em ${aguardandoCtes.grupos.length} fatura(s) de origem${aguardandoCtes.qtd ? ' — clique para ver' : ''}`}</div>
        </div>
      </div>

      {verCtesAguardando && aguardandoCtes.qtd > 0 && (
        <div className="table-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <div className="panel-title audit-table-title">CT-es aguardando nova fatura — {linhasAguardando.length} de {aguardandoCtes.qtd}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={buscaAguardando} onChange={(e) => setBuscaAguardando(e.target.value)} placeholder="CT-e, fatura ou transportadora" style={{ minWidth: 240 }} />
              <button type="button" className="btn-secondary" disabled={!linhasAguardando.length} onClick={exportarAguardando} title="Exporta a lista (respeita a busca) em Excel">Exportar</button>
              <button type="button" className="btn-secondary" onClick={() => setVerCtesAguardando(false)}>Fechar</button>
            </div>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 420 }}>
            <table>
              <thead><tr><th>CT-e</th><th>Chave do CT-e</th><th>Transportadora</th><th>Fatura de origem</th><th>Status da fatura de origem</th><th>Situacao do CT-e</th><th>Entrega</th><th>Valor</th><th>Retirado em</th><th>Dias</th><th>Por</th><th></th></tr></thead>
              <tbody>
                {linhasAguardando.map((r) => {
                  const fat = faturaPorId.get(String(r.fatura_origem_id));
                  return (
                    <tr key={`${r.chave}-${r.fatura_origem_id}`}>
                      <td title={r.chave}>{r.numero_cte || String(r.chave || '').slice(-9)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{String(r.chave || '').length >= 44 ? r.chave : '-'}</td>
                      <td>{r.transportadora || fat?.transportadora || '-'}</td>
                      <td>{r.numero_fatura_origem || '-'}</td>
                      <td>{fat ? (ROTULO_STATUS[fat.status] || fat.status) : '-'}</td>
                      <td title={r.motivo || ''}><strong style={{ color: '#b45309' }}>Aguardando nova fatura</strong></td>
                      <td>{(() => { const e = rotuloEntrega(r); return <strong style={{ color: e.cor }}>{e.texto}</strong>; })()}</td>
                      <td>{dinheiro(r.valor_cte)}</td>
                      <td>{dataBr(r.criado_em)}</td>
                      <td>{diasDesde(r.criado_em) ?? '-'}</td>
                      <td>{r.criado_por || '-'}</td>
                      <td>{fat && onAbrirFatura ? <button type="button" className="btn-secondary" onClick={() => onAbrirFatura(fat)}>Abrir fatura</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px' }}>Por vencimento</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {FAIXAS.map((fx) => (
          <button key={fx.id} type="button" style={cartao(faixa === fx.id, fx.cor)} onClick={() => setFaixa(faixa === fx.id ? '' : fx.id)}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{fx.rotulo}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: faixa === fx.id ? '#fff' : fx.cor }}>{contagemFaixa(fx)}</div>
          </button>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px' }}>Por etapa</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {ETAPAS.map((et) => {
          const qtd = contagemEtapa(et.id);
          const extra = et.id === 'suprimentos' ? ctx.semFaturaSup : et.id === 'transporte' ? ctx.semFaturaTrans : 0;
          return (
            <button key={et.id} type="button" title={et.dica} style={{ ...cartao(etapa === et.id, et.cor), opacity: qtd || extra ? 1 : 0.6 }} onClick={() => setEtapa(etapa === et.id ? '' : et.id)}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{et.rotulo}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: etapa === et.id ? '#fff' : et.cor }}>{qtd}</div>
              {extra > 0 && <div style={{ fontSize: 11 }}>+{extra} CT-e(s) sem fatura vinculada</div>}
            </button>
          );
        })}
      </div>

      {etapa === 'erpSemLiberacao' && (
        <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c' }}>
          <strong>Regra:</strong> so pode ir para o ERP fatura liberada para pagamento. As faturas abaixo ja foram enviadas ao ERP sem a liberacao —
          o auditor precisa liberar ou, havendo cobranca a maior, enviar para a gestao. Use "Copiar aviso" para avisar o auditor.
        </div>
      )}

      {!auditorSel && resumoPorAuditor.length > 0 && (
        <div className="table-card" style={{ marginBottom: 14 }}>
          <div className="panel-title audit-table-title">Resumo por auditor (clique no nome para abrir o painel dele)</div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Auditor</th><th>Em aberto</th><th>Vencidas</th><th>Para auditar</th><th>Fornecedor</th><th>Gestao</th><th>ERP sem liberacao</th><th>Desconto no mes</th></tr></thead>
              <tbody>
                {resumoPorAuditor.map((r) => (
                  <tr key={r.nome}>
                    <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setAuditorSel(r.nome)}>{r.nome}</button></td>
                    <td>{r.abertas}</td>
                    <td style={{ color: r.vencidas ? '#b91c1c' : undefined, fontWeight: r.vencidas ? 700 : 400 }}>{r.vencidas}</td>
                    <td>{r.auditar}</td><td>{r.fornecedor}</td><td>{r.gestao}</td>
                    <td style={{ color: r.erp ? '#b91c1c' : undefined, fontWeight: r.erp ? 700 : 400 }}>{r.erp}</td>
                    <td>{dinheiro(descontoMes.porAuditor.get(r.nome)?.valor || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-card" style={{ marginBottom: 14 }}>
        <div className="panel-title audit-table-title">
          {etapa ? ETAPAS.find((e) => e.id === etapa).rotulo : 'Todas as faturas em aberto'}
          {faixa ? ` · ${FAIXAS.find((x) => x.id === faixa).rotulo}` : ''} — {lista.length} fatura(s) · {dinheiro(valorLista)}
        </div>
        <div className="sim-analise-tabela-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Fatura</th><th>Transportadora</th>{mostrarAuditorCol && <th>Auditor</th>}<th>Vencimento</th><th>Valor</th><th>Etapa</th><th>Parada ha</th><th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {!lista.length && <tr><td colSpan={mostrarAuditorCol ? 8 : 7}>Nenhuma fatura com esses filtros.</td></tr>}
              {lista.map((f) => {
                const dias = diasAte(f.data_vencimento);
                const corDias = dias == null ? '#64748b' : dias < 0 ? '#b91c1c' : dias <= 3 ? '#c2410c' : '#334155';
                const parada = diasParado(f);
                const et = etapaDe(f);
                const erpAlerta = dentroDaEtapa('erpSemLiberacao', f, ctx);
                const qtdDemandas = faturasComDemanda.get(String(f.id)) || 0;
                return (
                  <tr key={f.id} style={erpAlerta ? { background: '#fef2f2' } : undefined}>
                    <td>
                      <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => onAbrirFatura?.(f)} title="Abrir fatura na auditoria">{f.numero_fatura}</button>
                      {qtdDemandas > 0 && <span title="Demandas abertas nesta fatura" style={{ marginLeft: 6, fontSize: 11, background: '#ede9fe', color: '#6d28d9', borderRadius: 8, padding: '1px 6px' }}>📝 {qtdDemandas}</span>}
                    </td>
                    <td>{f.transportadora}</td>
                    {mostrarAuditorCol && <td>{f.auditor_nome || <strong className="error-text">SEM AUDITOR</strong>}</td>}
                    <td>{dataBr(f.data_vencimento)} <strong style={{ color: corDias }}>({dias == null ? '-' : dias < 0 ? `${-dias}d atraso` : dias === 0 ? 'hoje' : `${dias}d`})</strong></td>
                    <td>{dinheiro(f.valor_fatura)}</td>
                    <td style={{ color: et.cor, fontWeight: erpAlerta ? 700 : 400 }}>{et.texto}</td>
                    <td>{parada == null ? '-' : `${parada} dia(s)`}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-secondary" style={{ padding: '2px 8px', marginRight: 4 }} onClick={() => anotarFatura(f)}>Anotar</button>
                      {erpAlerta && <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => copiarAviso(f)}>{copiado === String(f.id) ? 'Copiado!' : 'Copiar aviso'}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CtesSemFaturaPainel
        escopo={auditorSel === 'MINHAS' ? 'MINHAS' : (auditorSel || 'TODOS')}
        meuNome={meuNome}
        meuEmail={meuEmail}
        mostrarAuditor={mostrarAuditorCol}
      />

      <div className="table-card">
        <div className="panel-title audit-table-title">
          Minhas demandas — {abertasDemandas.length} em aberto{demandasHoje ? ` · ${demandasHoje} para hoje/atrasada(s)` : ''}
        </div>
        {demandasLocais && <div className="hint-box compact">Demandas salvas apenas neste navegador (tabela auditoria_demandas ainda nao criada no banco).</div>}
        {erro && <div className="hint-box compact error-text">{erro}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', margin: '8px 0 12px' }}>
          <label className="field" style={{ flex: '2 1 260px' }}>O que precisa fazer
            <input ref={tituloRef} value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') adicionarDemanda(); }} placeholder="Ex.: cobrar retorno da transportadora" />
          </label>
          <label className="field" style={{ width: 130 }}>Fatura (opcional)
            <input value={form.numero} onChange={(e) => setForm((p) => ({ ...p, numero: e.target.value }))} placeholder="Numero" />
          </label>
          <label className="field" style={{ width: 150 }}>Prazo
            <input type="date" value={form.prazo} onChange={(e) => setForm((p) => ({ ...p, prazo: e.target.value }))} />
          </label>
          <label className="field" style={{ flex: '2 1 220px' }}>Observacao
            <input value={form.observacao} onChange={(e) => setForm((p) => ({ ...p, observacao: e.target.value }))} placeholder="Detalhes (opcional)" />
          </label>
          <button type="button" className="btn-primary" onClick={adicionarDemanda}>Adicionar</button>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th style={{ width: 30 }} /><th>Demanda</th><th>Fatura</th><th>Prazo</th>{gestor && <th>Auditor</th>}<th /></tr></thead>
            <tbody>
              {!abertasDemandas.length && <tr><td colSpan={gestor ? 6 : 5}>Nenhuma demanda em aberto.</td></tr>}
              {abertasDemandas.map((d) => {
                const atrasada = d.prazo && d.prazo < hojeIso;
                const fat = d.fatura_id ? (state.faturas || []).find((f) => String(f.id) === String(d.fatura_id)) : null;
                return (
                  <tr key={d.id}>
                    <td><input type="checkbox" checked={false} onChange={() => alternarConclusao(d)} title="Marcar como concluida" /></td>
                    <td>{d.titulo}{d.observacao && <div style={{ fontSize: 12, color: '#64748b' }}>{d.observacao}</div>}</td>
                    <td>{fat ? <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => onAbrirFatura?.(fat)}>{d.numero_fatura}</button> : (d.numero_fatura || '-')}{d.transportadora && <div style={{ fontSize: 11, color: '#64748b' }}>{d.transportadora}</div>}</td>
                    <td style={{ color: atrasada ? '#b91c1c' : undefined, fontWeight: atrasada ? 700 : 400 }}>{d.prazo ? dataBr(d.prazo) : '-'}{atrasada ? ' (atrasada)' : ''}</td>
                    {gestor && <td>{d.auditor_nome || '-'}</td>}
                    <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => removerDemanda(d)}>Excluir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {concluidasDemandas.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Concluidas recentemente ({concluidasDemandas.length})</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
              {concluidasDemandas.map((d) => (
                <li key={d.id}><s>{d.titulo}</s> {d.numero_fatura ? `(fatura ${d.numero_fatura})` : ''} <button type="button" className="btn-secondary" style={{ padding: '0 6px', marginLeft: 6 }} onClick={() => alternarConclusao(d)}>Reabrir</button></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
