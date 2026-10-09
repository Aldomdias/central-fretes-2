import { useState } from 'react';
import { lerZip } from '../utils/zipLeitor';
import { consolidarFaturasDoccob, decodificarTextoDoccob, parseDoccobTexto } from '../utils/doccobParser';
import { analisarFaturasDoccob, importarFaturasDoccob } from '../services/importarFaturasDoccobService';
import { carregarSessao } from '../utils/authLocal';

const fmtMoeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '-');

async function lerArquivos(files) {
  const textos = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      const conteudo = lerZip(bytes);
      Object.entries(conteudo).forEach(([nome, dados]) => {
        if (/\.(txt|doccob|edi)$/i.test(nome) || !/\.[a-z0-9]+$/i.test(nome)) textos.push({ nome, texto: decodificarTextoDoccob(dados) });
      });
    } else {
      textos.push({ nome: file.name, texto: decodificarTextoDoccob(bytes) });
    }
  }
  return textos;
}

// Sobe faturas direto do arquivo DocCob (EDI) da transportadora, em .zip ou .txt,
// no lugar de exportar do Verum.
export default function ImportarDoccobCard() {
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [leitura, setLeitura] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');

  async function selecionar(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErro('');
    setResultado(null);
    setLeitura(null);
    setLendo(true);
    try {
      const textos = await lerArquivos(files);
      const { faturas, repetidas } = consolidarFaturasDoccob(textos.map((t) => parseDoccobTexto(t.texto, t.nome)));
      if (!faturas.length) throw new Error('Nenhuma fatura encontrada. Confirme se o arquivo e um DocCob (registros 350/352/353).');
      const { existentes } = await analisarFaturasDoccob(faturas);
      setLeitura({ faturas, repetidas, arquivos: textos.length, existentes });
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setLendo(false);
    }
  }

  async function importar() {
    if (!leitura) return;
    setImportando(true);
    setErro('');
    try {
      const sessao = carregarSessao();
      const res = await importarFaturasDoccob(leitura.faturas, {
        usuario: sessao?.nome || sessao?.email || '',
        onProgresso: (feitas, total) => setProgresso(`Gravando ${feitas} de ${total} fatura(s)...`),
      });
      setResultado(res);
      setLeitura(null);
      window.dispatchEvent(new Event('envios-erp-atualizados'));
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setImportando(false);
      setProgresso('');
    }
  }

  const totalCtes = leitura?.faturas.reduce((s, f) => s + f.ctes.length, 0) || 0;
  const totalValor = leitura?.faturas.reduce((s, f) => s + f.valor_fatura, 0) || 0;
  const divergentes = leitura?.faturas.filter((f) => Math.abs(f.soma_ctes - f.valor_fatura) > 0.02) || [];

  return (
    <div style={{ padding: 20, display: 'grid', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        Use o mesmo arquivo DocCob (.zip ou .txt) que você sobe no Verum. Cada fatura entra com seus CT-es, vencimento e valor.
        Faturas que já existem no sistema não são sobrescritas — só entram os CT-es que faltam.
      </p>
      <div>
        <input type="file" accept=".zip,.txt" multiple disabled={lendo || importando} onChange={(e) => { selecionar(e.target.files); e.target.value = ''; }} />
        {lendo && <span style={{ marginLeft: 10, fontSize: 13 }}>Lendo arquivo...</span>}
      </div>

      {erro && <div style={{ color: '#b91c1c', fontSize: 13 }}>{erro}</div>}

      {leitura && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13 }}>
            <strong>{leitura.faturas.length}</strong> fatura(s), <strong>{totalCtes.toLocaleString('pt-BR')}</strong> CT-e(s), {fmtMoeda(totalValor)}
            {' '}— {leitura.faturas.length - leitura.existentes.size} nova(s), {leitura.existentes.size} já existente(s).
            {leitura.repetidas > 0 && ` ${leitura.repetidas} repetida(s) no arquivo foram ignoradas.`}
          </div>
          {divergentes.length > 0 && (
            <div style={{ fontSize: 13, color: '#b45309' }}>
              Atenção: em {divergentes.length} fatura(s) a soma dos CT-es difere do valor da fatura.
            </div>
          )}
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--surface, #fff)' }}>
                  <th style={{ padding: 6 }}>Fatura</th><th>Transportadora</th><th>Emissão</th><th>Vencimento</th>
                  <th style={{ textAlign: 'right' }}>CT-es</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {leitura.faturas.map((f) => (
                  <tr key={`${f.cnpj_transportadora}-${f.numero_fatura}-${f.serie_fatura}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: 6 }}>{f.numero_fatura}</td>
                    <td>{f.transportadora}</td>
                    <td>{fmtData(f.data_emissao)}</td>
                    <td>{fmtData(f.data_vencimento)}</td>
                    <td style={{ textAlign: 'right' }}>{f.ctes.length}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoeda(f.valor_fatura)}</td>
                    <td>{leitura.existentes.has(f) ? 'Já existe' : 'Nova'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" className="btn-primary" onClick={importar} disabled={importando}>
              {importando ? progresso || 'Importando...' : `Importar ${leitura.faturas.length} fatura(s)`}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
          <div>
            Importação concluída: {resultado.novas} fatura(s) nova(s), {resultado.existentes} já existente(s),
            {' '}{resultado.ctesGravados.toLocaleString('pt-BR')} CT-e(s) gravado(s)
            {resultado.ctesJaExistiam > 0 && ` (${resultado.ctesJaExistiam.toLocaleString('pt-BR')} já estavam nas faturas)`}.
          </div>
          {resultado.erros.length > 0 && (
            <div style={{ color: '#b91c1c' }}>
              {resultado.erros.length} erro(s):
              <ul style={{ margin: '4px 0 0 18px' }}>{resultado.erros.slice(0, 10).map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          <div style={{ color: 'var(--muted)' }}>Para calcular o status AMD, abra a fatura na Auditoria e use "Recalcular CT-es".</div>
        </div>
      )}
    </div>
  );
}
