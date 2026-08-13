import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { parsePlanilhaDadosBancarios, inferirTipoChavePix } from '../utils/dadosBancariosImport';
import { formatarCnpj } from '../utils/cnpj';
import {
  importarDadosBancariosTransportadoras,
  inativarDadosBancariosTransportadora,
  listarDadosBancariosTransportadoras,
  salvarDadosBancariosTransportadora,
} from '../services/auditoriaFretesService';

const FORM_VAZIO = {
  id: '', transportadora: '', cnpj: '', favorecido: '', banco: '', codigo_banco: '',
  agencia: '', conta: '', tipo_conta: '', chave_pix: '', tipo_chave_pix: '', principal: true, ativo: true, observacao: '',
};

export default function DadosBancariosTransportadoras({ sessao }) {
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [previaImportacao, setPreviaImportacao] = useState(null);

  const recarregar = () => {
    setCarregando(true);
    listarDadosBancariosTransportadoras()
      .then(setRegistros)
      .catch((error) => setErro(error.message || String(error)))
      .finally(() => setCarregando(false));
  };

  useEffect(() => { recarregar(); }, []);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    if (!termo) return registros;
    return registros.filter((item) =>
      String(item.transportadora || '').toUpperCase().includes(termo)
      || String(item.cnpj || '').replace(/\D/g, '').includes(termo.replace(/\D/g, '')));
  }, [registros, busca]);

  const escolherArquivo = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setErro('');
    setMensagem('');
    try {
      const workbook = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      const { registros: parseados, avisos } = parsePlanilhaDadosBancarios(linhas);
      setPreviaImportacao({ registros: parseados, avisos });
    } catch (error) {
      setErro(`Erro ao ler a planilha: ${error.message || error}`);
    }
  };

  const confirmarImportacao = async () => {
    if (!previaImportacao?.registros?.length) return;
    setImportando(true);
    setErro('');
    try {
      const resultado = await importarDadosBancariosTransportadoras(previaImportacao.registros, {
        nome: sessao?.nome || sessao?.email || 'Usuario local',
      });
      setMensagem(`Importacao concluida: ${resultado.importados} novo(s), ${resultado.atualizados} atualizado(s).`);
      setPreviaImportacao(null);
      recarregar();
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setImportando(false);
    }
  };

  const editar = (item) => setForm({ ...FORM_VAZIO, ...item });

  const salvar = async () => {
    if (!form.transportadora.trim()) { setErro('Informe a transportadora.'); return; }
    if (!form.cnpj.trim() && !form.chave_pix.trim() && !form.conta.trim()) {
      setErro('Informe ao menos CNPJ, PIX ou conta bancaria.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await salvarDadosBancariosTransportadora({
        ...form,
        id: form.id || undefined,
        cnpj: form.cnpj ? formatarCnpj(form.cnpj) : '',
        tipo_chave_pix: form.chave_pix ? (form.tipo_chave_pix || inferirTipoChavePix(form.chave_pix)) : '',
        atualizado_por: sessao?.nome || sessao?.email || 'Usuario local',
      });
      setMensagem('Cadastro salvo.');
      setForm(FORM_VAZIO);
      recarregar();
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setSalvando(false);
    }
  };

  const inativar = async (item) => {
    await inativarDadosBancariosTransportadora(item.id);
    recarregar();
  };

  return (
    <div className="panel-card">
      <div className="panel-title">Dados Bancarios das Transportadoras</div>
      <p className="compact">Cadastro usado para preencher automaticamente o Protocolo Financeiro quando o tipo de envio for "Dados Bancarios".</p>

      <div className="form-grid three">
        <label className="field">Importar planilha (RESPONSAVEL, TRANSPORTADORAS, BANCO, AGENCIA, CONTA, PIX, CNPJ - CPF)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={escolherArquivo} />
        </label>
        <label className="field">Buscar<input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Transportadora ou CNPJ" /></label>
      </div>

      {previaImportacao && (
        <div className="hint-box compact">
          <strong>{previaImportacao.registros.length} registro(s) prontos para importar.</strong>
          {previaImportacao.avisos.length > 0 && (
            <ul>{previaImportacao.avisos.slice(0, 10).map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>
          )}
          <div className="audit-form-actions">
            <button className="btn-primary" disabled={importando} onClick={confirmarImportacao}>{importando ? 'Importando...' : 'Confirmar importacao'}</button>
            <button className="btn-secondary" onClick={() => setPreviaImportacao(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {mensagem && <div className="hint-box compact">{mensagem}</div>}
      {erro && <div className="hint-box compact error-text">{erro}</div>}

      <h2>{form.id ? 'Editar cadastro' : 'Novo cadastro manual'}</h2>
      <div className="form-grid three">
        <label className="field">Transportadora<input value={form.transportadora} onChange={(event) => setForm({ ...form, transportadora: event.target.value })} /></label>
        <label className="field">CNPJ<input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} /></label>
        <label className="field">Favorecido<input value={form.favorecido} onChange={(event) => setForm({ ...form, favorecido: event.target.value })} /></label>
        <label className="field">Banco<input value={form.banco} onChange={(event) => setForm({ ...form, banco: event.target.value })} /></label>
        <label className="field">Agencia<input value={form.agencia} onChange={(event) => setForm({ ...form, agencia: event.target.value })} /></label>
        <label className="field">Conta<input value={form.conta} onChange={(event) => setForm({ ...form, conta: event.target.value })} /></label>
        <label className="field">Chave PIX<input value={form.chave_pix} onChange={(event) => setForm({ ...form, chave_pix: event.target.value })} /></label>
        <label className="field">Tipo chave PIX
          <select value={form.tipo_chave_pix} onChange={(event) => setForm({ ...form, tipo_chave_pix: event.target.value })}>
            <option value="">Auto</option>
            <option value="CNPJ_CPF">CNPJ/CPF</option>
            <option value="EMAIL">E-mail</option>
            <option value="TELEFONE">Telefone</option>
            <option value="ALEATORIA">Aleatoria</option>
            <option value="OUTRO">Outro</option>
          </select>
        </label>
        <label className="field">Principal desta transportadora
          <select value={form.principal ? '1' : '0'} onChange={(event) => setForm({ ...form, principal: event.target.value === '1' })}>
            <option value="1">Sim</option>
            <option value="0">Nao</option>
          </select>
        </label>
      </div>
      <div className="audit-form-actions">
        <button className="btn-primary" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando...' : form.id ? 'Salvar alteracoes' : 'Cadastrar'}</button>
        {form.id && <button className="btn-secondary" onClick={() => setForm(FORM_VAZIO)}>Cancelar edicao</button>}
      </div>

      <h2>Cadastros ({filtrados.length})</h2>
      {carregando ? <div className="hint-box compact">Carregando...</div> : (
        <table>
          <thead><tr><th>Transportadora</th><th>CNPJ</th><th>Banco/Agencia/Conta</th><th>PIX</th><th>Principal</th><th>Ativo</th><th></th></tr></thead>
          <tbody>
            {filtrados.map((item) => (
              <tr key={item.id} style={!item.ativo ? { opacity: 0.5 } : undefined}>
                <td>{item.transportadora}</td>
                <td>{item.cnpj || '-'}</td>
                <td>{item.banco ? `${item.banco} ag ${item.agencia || '-'} cc ${item.conta || '-'}` : '-'}</td>
                <td>{item.chave_pix || '-'}</td>
                <td>{item.principal ? 'Sim' : 'Nao'}</td>
                <td>{item.ativo ? 'Sim' : 'Nao'}</td>
                <td>
                  <button className="btn-secondary audit-small-button" onClick={() => editar(item)}>Editar</button>
                  {item.ativo && <button className="btn-secondary audit-small-button" onClick={() => inativar(item)}>Inativar</button>}
                </td>
              </tr>
            ))}
            {!filtrados.length && <tr><td colSpan="7">Nenhum cadastro encontrado.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
