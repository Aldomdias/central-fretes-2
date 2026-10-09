import { useEffect, useMemo, useState } from 'react';
import { MODULOS_SISTEMA } from '../utils/authLocal';
import { MENU_GRUPOS } from './Sidebar';
import { abrirChamado, atualizarChamado, listarChamados, STATUS_CHAMADO, URGENCIAS_CHAMADO } from '../services/chamadosService';

const estilo = {
  botao: { position: 'fixed', right: 264, bottom: 16, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontWeight: 600 },
  fundo: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  painel: { width: 640, maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0f172a', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,.35)', padding: 16 },
  campo: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, fontSize: 12, color: '#475569', fontWeight: 600 },
  input: { height: 36, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 400 },
  area: { minHeight: 110, padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 400, fontFamily: 'inherit', resize: 'vertical' },
  primario: { height: 38, padding: '0 16px', border: 'none', borderRadius: 8, background: '#1d4ed8', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  aba: (ativa) => ({ padding: '6px 12px', border: 'none', borderBottom: ativa ? '2px solid #1d4ed8' : '2px solid transparent', background: 'none', cursor: 'pointer', fontWeight: 600, color: ativa ? '#1d4ed8' : '#64748b' }),
  item: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 },
};

const COR_URGENCIA = { BAIXA: '#64748b', MEDIA: '#2563eb', ALTA: '#d97706', CRITICA: '#dc2626' };
const labelDe = (lista, chave) => lista.find((i) => i.chave === chave)?.label || chave;
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const formVazio = { tipo: 'PROBLEMA', modulo: '', titulo: '', descricao: '', urgencia: 'MEDIA' };

export default function ChamadoRapidoModal({ sessao, paginaAtual }) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState('novo');
  const [form, setForm] = useState(formVazio);
  const [enviando, setEnviando] = useState(false);
  const [arquivos, setArquivos] = useState([]);
  const [msg, setMsg] = useState({ texto: '', erro: false });
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const gestao = sessao?.perfil === 'GESTAO';

  // Nomes como aparecem no menu lateral + nomes do cadastro de modulos (sem repetir).
  const modulos = useMemo(() => {
    const nomes = [...MENU_GRUPOS.flatMap((g) => g.itens.map((i) => i.label)), ...MODULOS_SISTEMA.map((m) => m.label)];
    const vistos = new Set();
    const lista = nomes.filter((n) => { const k = n.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
    return [...lista.sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Outro / Geral'];
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const atual = MENU_GRUPOS.flatMap((g) => g.itens).find((i) => i.chave === paginaAtual)?.label || MODULOS_SISTEMA.find((m) => m.chave === paginaAtual)?.label || '';
    setForm((f) => (f.modulo ? f : { ...f, modulo: atual }));
  }, [aberto, paginaAtual]);

  async function carregar() {
    setCarregando(true);
    try { setLista(await listarChamados({ sessao, todos: gestao })); } catch (err) { setMsg({ texto: err.message, erro: true }); } finally { setCarregando(false); }
  }

  useEffect(() => { if (aberto && aba === 'lista') carregar(); }, [aberto, aba]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function enviar(e) {
    e.preventDefault();
    const moduloOk = modulos.find((m) => m.toLowerCase() === form.modulo.trim().toLowerCase());
    if (!moduloOk) {
      setMsg({ texto: 'Escolha um módulo da lista (digite para filtrar).', erro: true });
      return;
    }
    if (!form.titulo.trim() || !form.descricao.trim()) {
      setMsg({ texto: 'Informe um título e a descrição.', erro: true });
      return;
    }
    setEnviando(true);
    setMsg({ texto: '', erro: false });
    try {
      const r = await abrirChamado({ sessao, ...form, modulo: moduloOk, paginaOrigem: paginaAtual, arquivos });
      setMsg({ texto: `Chamado #${r?.numero ?? ''} aberto com sucesso.`, erro: false });
      setForm({ ...formVazio, modulo: form.modulo });
      setArquivos([]);
    } catch (err) {
      setMsg({ texto: err.message || 'Não foi possível abrir o chamado.', erro: true });
    } finally {
      setEnviando(false);
    }
  }

  async function mudar(item, patch) {
    try {
      await atualizarChamado(item.id, { ...patch, sessao });
      setLista((l) => l.map((c) => (c.id === item.id ? { ...c, ...patch } : c)));
    } catch (err) {
      setMsg({ texto: err.message, erro: true });
    }
  }

  return (
    <>
      <button type="button" style={estilo.botao} onClick={() => setAberto(true)} title="Abrir chamado (problema ou melhoria)">
        Abrir chamado
      </button>
      {aberto ? (
        <div style={estilo.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false); }}>
          <div style={estilo.painel} role="dialog" aria-label="Abrir chamado">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 16 }}>Chamados</strong>
              <button type="button" onClick={() => setAberto(false)} style={{ cursor: 'pointer' }} aria-label="Fechar">✕</button>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
              <button type="button" style={estilo.aba(aba === 'novo')} onClick={() => setAba('novo')}>Novo chamado</button>
              <button type="button" style={estilo.aba(aba === 'lista')} onClick={() => setAba('lista')}>{gestao ? 'Todos os chamados' : 'Meus chamados'}</button>
            </div>
            {msg.texto ? <div style={{ fontSize: 13, marginBottom: 8, color: msg.erro ? '#dc2626' : '#15803d' }}>{msg.texto}</div> : null}

            {aba === 'novo' ? (
              <form onSubmit={enviar} style={{ overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                  <label style={estilo.campo}>Tipo
                    <select style={estilo.input} value={form.tipo} onChange={set('tipo')}>
                      <option value="PROBLEMA">Problema / erro</option>
                      <option value="MELHORIA">Melhoria / sugestão</option>
                    </select>
                  </label>
                  <label style={estilo.campo}>Módulo
                    <input style={estilo.input} list="chamado-modulos" value={form.modulo} onChange={set('modulo')} placeholder="Digite para pesquisar..." autoComplete="off" />
                    <datalist id="chamado-modulos">
                      {modulos.map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </label>
                  <label style={estilo.campo}>Urgência
                    <select style={estilo.input} value={form.urgencia} onChange={set('urgencia')}>
                      {URGENCIAS_CHAMADO.map((u) => <option key={u.chave} value={u.chave}>{u.label}</option>)}
                    </select>
                  </label>
                </div>
                <label style={estilo.campo}>Título
                  <input style={estilo.input} value={form.titulo} onChange={set('titulo')} maxLength={140} placeholder="Resumo em uma linha" />
                </label>
                <label style={estilo.campo}>{form.tipo === 'PROBLEMA' ? 'Qual é o problema? (o que fez, o que esperava, o que aconteceu)' : 'Qual a melhoria desejada?'}
                  <textarea style={estilo.area} value={form.descricao} onChange={set('descricao')} />
                </label>
                <label style={estilo.campo}>Anexos (prints, planilhas, PDF — opcional, até 20 MB cada)
                  <input type="file" multiple style={{ fontSize: 13, fontWeight: 400 }} onChange={(e) => setArquivos((a) => [...a, ...Array.from(e.target.files || [])])} />
                </label>
                {arquivos.map((a, i) => (
                  <div key={`${a.name}-${i}`} style={{ fontSize: 12, marginBottom: 4 }}>
                    📎 {a.name} <button type="button" onClick={() => setArquivos((l) => l.filter((_, j) => j !== i))} style={{ cursor: 'pointer', marginLeft: 6 }} aria-label="Remover anexo">✕</button>
                  </div>
                ))}
                <button type="submit" style={estilo.primario} disabled={enviando}>{enviando ? 'Enviando...' : 'Abrir chamado'}</button>
              </form>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {carregando ? <div style={{ fontSize: 13 }}>Carregando...</div> : null}
                {!carregando && !lista.length ? <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum chamado encontrado.</div> : null}
                {lista.map((c) => (
                  <div key={c.id} style={estilo.item}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong>#{c.numero} · {c.titulo}</strong>
                      <span style={{ color: COR_URGENCIA[c.urgencia], fontWeight: 700, fontSize: 12 }}>{labelDe(URGENCIAS_CHAMADO, c.urgencia)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', margin: '2px 0 6px' }}>
                      {c.tipo === 'MELHORIA' ? 'Melhoria' : 'Problema'} · {c.modulo} · {dataHora(c.created_at)}{gestao ? ` · ${c.usuario_nome}` : ''}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{c.descricao}</div>
                    {(c.anexos || []).map((a) => (
                      <div key={a.path} style={{ fontSize: 12, marginTop: 4 }}>📎 <a href={a.url} target="_blank" rel="noreferrer">{a.nome}</a></div>
                    ))}
                    {c.resposta && !gestao ? <div style={{ marginTop: 6, padding: 6, background: '#f1f5f9', borderRadius: 6 }}><strong>Resposta:</strong> {c.resposta}</div> : null}
                    {gestao ? (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <select style={{ ...estilo.input, height: 32 }} value={c.status} onChange={(e) => mudar(c, { status: e.target.value })}>
                          {STATUS_CHAMADO.map((s) => <option key={s.chave} value={s.chave}>{s.label}</option>)}
                        </select>
                        <input style={{ ...estilo.input, height: 32, flex: 1, minWidth: 160 }} defaultValue={c.resposta || ''} placeholder="Resposta ao usuário (Enter salva)"
                          onKeyDown={(e) => { if (e.key === 'Enter') mudar(c, { resposta: e.target.value }); }} />
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700 }}>Status: {labelDe(STATUS_CHAMADO, c.status)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
