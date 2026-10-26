import { useMemo, useState } from 'react';
import { baixarBoletoGuardado, guardarBoletos, marcarBoletosCopiados } from '../services/boletoControleService';
import { casarBoletosComFaturas, divergenciasBoleto, lerBoletoPdf } from '../utils/boletosPasta';
import { gravarArquivoNaPasta, nomeArquivoBoleto, obterPastaBoletos, pastaRedeSuportada } from '../utils/pastaRede';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const soDigitos = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');

// O auditor arrasta os PDFs dos boletos: o sistema le, confere com a fatura e guarda; depois um botao copia
// os guardados para a pasta de rede do financeiro (nome padronizado "numero - transportadora.pdf").
// exigem: faturas liberadas e ainda nao pagas; controle: linhas de fatura_boleto_controle.
export default function BoletosEnvioPainel({ exigem, controle, usuario, onSalvou, onErro }) {
  const [arrastando, setArrastando] = useState(false);
  const [processando, setProcessando] = useState('');
  const [resultado, setResultado] = useState(null); // { guardados: [], revisar: [] }
  const [copiando, setCopiando] = useState('');
  const [vinculo, setVinculo] = useState({});

  const porFatura = useMemo(() => new Map(controle.map((c) => [String(c.fatura_id), c])), [controle]);
  const idsExigem = useMemo(() => new Set(exigem.map((f) => String(f.id))), [exigem]);
  const aCopiar = useMemo(() => controle.filter((c) => c.boleto_arquivo_path && !c.boleto_copiado_em && idsExigem.has(String(c.fatura_id))), [controle, idsExigem]);
  const fatPorId = useMemo(() => new Map(exigem.map((f) => [String(f.id), f])), [exigem]);

  // Guarda um lote ja validado e devolve as linhas do relatorio.
  const guardar = async (itens) => {
    await guardarBoletos(itens.map((i) => ({ fatura: i.fatura, arquivo: i.arquivo, leitura: i.leitura, atual: porFatura.get(String(i.fatura.id)) })), { usuario });
  };

  const receber = async (lista) => {
    const arquivos = Array.from(lista || []).filter((a) => /\.pdf$/i.test(a.name));
    if (!arquivos.length) { onErro('Solte arquivos PDF.'); return; }
    onErro('');
    setResultado(null);
    try {
      const porNome = casarBoletosComFaturas(arquivos.map((a) => a.name), exigem).porFatura;
      const nomeParaFatura = new Map([...porNome].map(([id, v]) => [v.arquivo, { fatura: fatPorId.get(id), certeza: v.certeza }]));
      const lidos = [];
      for (let i = 0; i < arquivos.length; i += 1) {
        setProcessando(`Lendo boleto ${i + 1} de ${arquivos.length}: ${arquivos[i].name}`);
        lidos.push({ arquivo: arquivos[i], leitura: await lerBoletoPdf(arquivos[i]) });
      }
      setProcessando('Guardando...');
      const guardar_ = [];
      const revisar = [];
      const usadas = new Set(); // uma fatura recebe um boleto por vez
      const linhasVistas = new Map();
      lidos.forEach(({ arquivo, leitura }) => {
        let fatura = nomeParaFatura.get(arquivo.name)?.fatura;
        let origem = 'nome';
        if (!fatura && leitura.valor != null) {
          // Nome fora do padrao: tenta pelo conteudo (mesmo valor e mesmo vencimento, uma fatura so).
          const iguais = exigem.filter((f) => Math.abs(Number(f.valor_fatura || 0) - leitura.valor) <= 0.01
            && String(f.data_vencimento || '').slice(0, 10) === leitura.vencimento);
          if (iguais.length === 1) { fatura = iguais[0]; origem = 'valor e vencimento'; }
        }
        const item = { arquivo, leitura, fatura, origem };
        if (leitura.linhaDigitavel) {
          if (linhasVistas.has(leitura.linhaDigitavel)) { revisar.push({ ...item, motivo: `Boleto repetido (igual a ${linhasVistas.get(leitura.linhaDigitavel)})` }); return; }
          linhasVistas.set(leitura.linhaDigitavel, arquivo.name);
        }
        if (!fatura) { revisar.push({ ...item, motivo: 'Nao achei a fatura' }); return; }
        if (usadas.has(String(fatura.id))) { revisar.push({ ...item, motivo: 'Outro arquivo ja casou com esta fatura' }); return; }
        if (leitura.erro) { revisar.push({ ...item, motivo: `Nao consegui ler o boleto (${leitura.erro})` }); return; }
        const dif = divergenciasBoleto(leitura, fatura);
        if (dif.length) { revisar.push({ ...item, motivo: `Divergencia de ${dif.join(' e ')}: boleto ${dinheiro(leitura.valor)} venc. ${dataBr(leitura.vencimento)} x fatura ${dinheiro(fatura.valor_fatura)} venc. ${dataBr(fatura.data_vencimento)}` }); return; }
        const atual = porFatura.get(String(fatura.id));
        if (atual?.boleto_linha_digitavel && atual.boleto_linha_digitavel === leitura.linhaDigitavel) { revisar.push({ ...item, motivo: 'Este boleto ja esta guardado', info: true }); return; }
        usadas.add(String(fatura.id));
        guardar_.push(item);
      });
      if (guardar_.length) await guardar(guardar_);
      setResultado({ guardados: guardar_, revisar });
      await onSalvou();
    } catch (e) {
      onErro(e.message);
    } finally {
      setProcessando('');
    }
  };

  // Item em revisao: guardar assim mesmo (divergencia) ou vincular a uma fatura digitando o numero.
  const resolver = async (item, faturaEscolhida) => {
    try {
      await guardar([{ ...item, fatura: faturaEscolhida }]);
      setResultado((r) => ({ ...r, revisar: r.revisar.filter((x) => x !== item), guardados: [...r.guardados, { ...item, fatura: faturaEscolhida, origem: 'manual' }] }));
      await onSalvou();
    } catch (e) { onErro(e.message); }
  };
  const vincular = (item) => {
    const n = soDigitos(vinculo[item.arquivo.name]);
    const f = n && exigem.find((x) => soDigitos(x.numero_fatura) === n);
    if (!f) { onErro(`Fatura ${vinculo[item.arquivo.name] || ''} nao encontrada entre as liberadas para pagamento.`); return; }
    onErro('');
    resolver(item, f);
  };

  const enviarParaPasta = async (trocar = false) => {
    if (copiando) return;
    onErro('');
    try {
      const pasta = await obterPastaBoletos({ escolher: trocar });
      const feitos = [];
      for (let i = 0; i < aCopiar.length; i += 1) {
        const c = aCopiar[i];
        setCopiando(`Copiando ${i + 1} de ${aCopiar.length}...`);
        const blob = await baixarBoletoGuardado(c.boleto_arquivo_path);
        await gravarArquivoNaPasta(pasta, nomeArquivoBoleto(fatPorId.get(String(c.fatura_id)) || c), blob);
        feitos.push(c.fatura_id);
      }
      await marcarBoletosCopiados(feitos, usuario);
      await onSalvou();
    } catch (e) {
      if (e?.name !== 'AbortError') onErro(e.message || String(e));
    } finally {
      setCopiando('');
    }
  };

  const ocupado = !!processando || !!copiando;
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); if (!ocupado) receber(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${arrastando ? '#0369a1' : '#94a3b8'}`, borderRadius: 8, padding: 14, textAlign: 'center',
          background: arrastando ? '#e0f2fe' : '#f8fafc', color: '#334155',
        }}
      >
        <strong>Arraste os boletos (PDF) aqui</strong>
        <span style={{ margin: '0 8px' }}>ou</span>
        <label className="btn-primary audit-small-button" style={{ cursor: ocupado ? 'default' : 'pointer', opacity: ocupado ? 0.6 : 1 }}>
          Escolher arquivos
          <input type="file" multiple accept=".pdf" disabled={ocupado} style={{ display: 'none' }}
            onChange={(e) => { const l = Array.from(e.target.files || []); e.target.value = ''; receber(l); }} />
        </label>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          O sistema acha a fatura pelo nome (<em>número - transportadora</em>) ou pelo valor e vencimento, confere e guarda.
        </div>
        {processando && <div style={{ marginTop: 6, fontWeight: 700, color: '#0369a1' }}>{processando}</div>}
      </div>

      {resultado && (
        <div className="hint-box compact" style={{ marginTop: 8, borderLeft: `4px solid ${resultado.revisar.some((r) => !r.info) ? '#b45309' : '#14733b'}` }}>
          <strong>{resultado.guardados.length}</strong> boleto(s) conferido(s) e guardado(s)
          {resultado.revisar.length > 0 && <> · <strong>{resultado.revisar.length}</strong> para revisar</>}
          <button type="button" className="link-button" style={{ float: 'right' }} onClick={() => setResultado(null)}>fechar</button>
          {resultado.guardados.length > 0 && (
            <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
              {resultado.guardados.map((g) => (
                <li key={g.arquivo.name}>✓ {g.arquivo.name} → fatura {g.fatura.numero_fatura} ({dinheiro(g.leitura.valor)}, venc. {dataBr(g.leitura.vencimento)}){g.origem !== 'nome' && ` — achada por ${g.origem}`}</li>
              ))}
            </ul>
          )}
          {resultado.revisar.length > 0 && (
            <ul style={{ margin: '6px 0 0 16px', fontSize: 12 }}>
              {resultado.revisar.map((r) => (
                <li key={r.arquivo.name} style={{ marginBottom: 4 }}>
                  <strong>{r.arquivo.name}</strong> — {r.motivo}
                  {!r.info && r.fatura && r.leitura && !r.leitura.erro && !r.motivo.startsWith('Boleto repetido') && !r.motivo.startsWith('Outro arquivo') && (
                    <button type="button" className="btn-secondary audit-small-button" style={{ marginLeft: 8 }} onClick={() => resolver(r, r.fatura)}>Guardar assim mesmo</button>
                  )}
                  {!r.info && !r.fatura && (
                    <span style={{ marginLeft: 8 }}>
                      <input placeholder="nº da fatura" style={{ width: 110 }} value={vinculo[r.arquivo.name] || ''}
                        onChange={(e) => setVinculo((v) => ({ ...v, [r.arquivo.name]: e.target.value }))} />
                      <button type="button" className="btn-secondary audit-small-button" style={{ marginLeft: 4 }} onClick={() => vincular(r)}>Vincular</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" className="btn-primary audit-small-button" disabled={!aCopiar.length || ocupado || !pastaRedeSuportada()} onClick={() => enviarParaPasta(false)}>
          {copiando || `Enviar para a pasta do financeiro (${aCopiar.length})`}
        </button>
        <button type="button" className="btn-secondary audit-small-button" disabled={ocupado || !pastaRedeSuportada()} onClick={() => obterPastaBoletos({ escolher: true }).catch((e) => { if (e?.name !== 'AbortError') onErro(e.message || String(e)); })}
          title="Escolher outra pasta de destino">
          Trocar pasta de destino
        </button>
        {!pastaRedeSuportada() && <span style={{ fontSize: 12, color: '#b91c1c' }}>Para copiar para a pasta use o Chrome ou o Edge.</span>}
        {pastaRedeSuportada() && aCopiar.length === 0 && <span style={{ fontSize: 12, color: '#475569' }}>Nenhum boleto guardado aguardando cópia.</span>}
      </div>
    </div>
  );
}
