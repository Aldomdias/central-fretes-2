import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { listarProdutosCatalogo, salvarProdutoCatalogo, excluirProdutoCatalogo, importarProdutosCatalogo, garantirProdutosCatalogo } from '../services/produtosCatalogoService';
import { listarEstoquePorCodigos, importarEstoquePorCentro } from '../services/estoqueCatalogoService';
import { parseNumeroPlanilha } from '../utils/parseNumeroPlanilha';

const FORM_VAZIO = { id: null, codigo: '', nome: '', pesoKg: '', cubagemM3: '' };

function normalizarCabecalho(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/³/g, '3')
    .trim().toLowerCase();
}

export default function ProdutosCatalogoPage() {
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importandoEstoquePorCentro, setImportandoEstoquePorCentro] = useState(false);
  const [estoquePorCodigo, setEstoquePorCodigo] = useState(new Map());

  async function carregar(termo = busca) {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarProdutosCatalogo({ busca: termo });
      setProdutos(lista);
      setEstoquePorCodigo(await listarEstoquePorCodigos(lista.map((item) => item.codigo)));
    } catch (e) {
      setErro(e.message || 'Erro ao carregar catálogo de produtos.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(''); }, []);

  async function onSalvar(e) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      await salvarProdutoCatalogo(form);
      setForm(FORM_VAZIO);
      setAviso('Produto salvo com sucesso.');
      await carregar();
    } catch (e2) {
      setErro(e2.message || 'Erro ao salvar produto.');
    } finally {
      setSalvando(false);
    }
  }

  function onEditar(produto) {
    setForm({
      id: produto.id,
      codigo: produto.codigo,
      nome: produto.nome,
      pesoKg: String(produto.peso_kg ?? ''),
      cubagemM3: String(produto.cubagem_m3 ?? ''),
    });
  }

  async function onExcluir(produto) {
    if (!window.confirm(`Excluir o produto "${produto.nome}"?`)) return;
    setErro('');
    try {
      await excluirProdutoCatalogo(produto.id);
      await carregar();
    } catch (e) {
      setErro(e.message || 'Erro ao excluir produto.');
    }
  }

  async function onImportarArquivo(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setImportando(true);
    setErro('');
    setAviso('');
    try {
      const buffer = await arquivo.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const planilha = workbook.Sheets[workbook.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json(planilha, { raw: false, defval: '' });

      const mapeadas = linhas.map((linha) => {
        const entradas = Object.entries(linha).reduce((acc, [chave, valor]) => {
          acc[normalizarCabecalho(chave)] = valor;
          return acc;
        }, {});
        const codigo = entradas['codigo'] ?? entradas['sku'] ?? '';
        const nome = entradas['nome / descricao'] ?? entradas['nome/descricao'] ?? entradas['nome'] ?? entradas['descricao'] ?? '';
        const pesoKg = parseNumeroPlanilha(entradas['peso estimado (kg)'] ?? entradas['peso (kg)'] ?? entradas['peso'], 0);
        const cubagemM3 = parseNumeroPlanilha(entradas['cubagem estimada (m3)'] ?? entradas['cubagem (m3)'] ?? entradas['cubagem'], 0);
        return { codigo, nome, pesoKg, cubagemM3 };
      }).filter((item) => item.codigo && item.nome);

      if (!mapeadas.length) {
        setErro('Nenhuma linha válida encontrada. Confira as colunas Código, Nome/descrição, Peso e Cubagem.');
        return;
      }

      const resultado = await importarProdutosCatalogo(mapeadas);
      setAviso(`Importação concluída: ${resultado.inseridos} produto(s) atualizado(s)/inserido(s).`);
      await carregar();
    } catch (e) {
      setErro(e.message || 'Erro ao importar planilha de produtos.');
    } finally {
      setImportando(false);
    }
  }

  async function onImportarEstoquePorCentro(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setImportandoEstoquePorCentro(true);
    setErro('');
    setAviso('');
    try {
      const buffer = await arquivo.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const planilha = workbook.Sheets[workbook.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json(planilha, { header: 1, raw: false, defval: '' });
      if (matriz.length < 2) {
        setErro('Planilha de estoque por centro vazia.');
        return;
      }
      const cabecalho = matriz[0];
      // primeira coluna = código do produto; ignora a última ("Total por Produto");
      // as colunas do meio são os códigos de centro.
      const idxUltimaColuna = cabecalho.length - 1;
      const ultimaColunaNormalizada = normalizarCabecalho(cabecalho[idxUltimaColuna]);
      const idxFimCentros = ultimaColunaNormalizada.includes('total') ? idxUltimaColuna : cabecalho.length;

      const linhasLongas = [];
      for (let i = 1; i < matriz.length; i += 1) {
        const linha = matriz[i];
        const codigo = String(linha[0] || '').trim();
        if (!codigo) continue;
        for (let j = 1; j < idxFimCentros; j += 1) {
          const centro = String(cabecalho[j] || '').trim();
          if (!centro) continue;
          const quantidade = parseNumeroPlanilha(linha[j], 0);
          if (quantidade) linhasLongas.push({ codigo, centro, quantidade });
        }
      }

      if (!linhasLongas.length) {
        setErro('Nenhuma linha de estoque por centro encontrada. Confira o formato: 1ª coluna = código do produto, demais colunas = códigos de centro.');
        return;
      }

      const resultado = await importarEstoquePorCentro(linhasLongas);
      await garantirProdutosCatalogo(linhasLongas.map((item) => item.codigo));
      setAviso(`Estoque por centro importado: ${resultado.inseridos} combinação(ões) produto/centro.`);
      await carregar();
    } catch (e) {
      setErro(e.message || 'Erro ao importar planilha de estoque por centro.');
    } finally {
      setImportandoEstoquePorCentro(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="page-top">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Cadastros</div>
          <h1>Catálogo de produtos</h1>
          <p>Cadastre produtos com peso e cubagem padrão para usar na simulação por produto.</p>
        </div>
      </header>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {aviso ? <div className="sim-alert info">{aviso}</div> : null}

      <section className="panel-card">
        <form className="sim-form-grid sim-grid-5" onSubmit={onSalvar}>
          <label>Código
            <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Ex: WL10330008" required />
          </label>
          <label>Nome / descrição
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Descrição do produto" required />
          </label>
          <label>Peso (kg)
            <input value={form.pesoKg} onChange={(e) => setForm({ ...form, pesoKg: e.target.value })} placeholder="Ex: 27.2" required />
          </label>
          <label>Cubagem (m³)
            <input value={form.cubagemM3} onChange={(e) => setForm({ ...form, cubagemM3: e.target.value })} placeholder="Ex: 0.24688" required />
          </label>
          <div className="sim-actions" style={{ alignSelf: 'end' }}>
            <button className="primary" type="submit" disabled={salvando}>{salvando ? 'Salvando...' : (form.id ? 'Atualizar produto' : 'Adicionar produto')}</button>
            {form.id ? <button type="button" className="sim-tab" onClick={() => setForm(FORM_VAZIO)}>Cancelar edição</button> : null}
          </div>
        </form>

        <div className="sim-actions" style={{ marginTop: 12 }}>
          <label className="sim-tab" style={{ cursor: 'pointer' }}>
            {importando ? 'Importando planilha...' : 'Importar planilha de produtos (.xlsx)'}
            <input type="file" accept=".xlsx,.xls" onChange={onImportarArquivo} disabled={importando} style={{ display: 'none' }} />
          </label>
          <label className="sim-tab" style={{ cursor: 'pointer' }}>
            {importandoEstoquePorCentro ? 'Importando estoque detalhado...' : 'Importar estoque detalhado (.xlsx)'}
            <input type="file" accept=".xlsx,.xls" onChange={onImportarEstoquePorCentro} disabled={importandoEstoquePorCentro} style={{ display: 'none' }} />
          </label>
        </div>
        <small style={{ color: '#64748b', display: 'block', marginTop: 6 }}>
          Produtos: Código, Nome/descrição, Peso estimado (kg), Cubagem estimada (m³).
          Estoque por centro: planilha "Estoque detalhado" (1ª coluna = código do produto, demais colunas = código do centro, última = Total por Produto) — usada pra mapear origens com estoque na simulação por produto.
        </small>
      </section>

      <section className="table-card">
        <div className="tracking-prazos-table-head">
          <div>
            <strong>Produtos cadastrados</strong>
            <small>{carregando ? 'Carregando...' : `${produtos.length} produto(s)`}</small>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') carregar(); }} placeholder="Buscar por código ou nome" />
            <button className="sim-tab" type="button" onClick={() => carregar()}>Buscar</button>
          </div>
        </div>
        <div className="tracking-prazos-table-wrap">
          <table>
            <thead>
              <tr><th>Código</th><th>Nome</th><th>Peso (kg)</th><th>Cubagem (m³)</th><th>Disponível</th><th></th></tr>
            </thead>
            <tbody>
              {produtos.map((produto) => {
                const estoque = estoquePorCodigo.get(String(produto.codigo).toUpperCase());
                return (
                <tr key={produto.id}>
                  <td>{produto.codigo}</td>
                  <td>{produto.nome}</td>
                  <td>{Number(produto.peso_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td>{Number(produto.cubagem_m3).toLocaleString('pt-BR', { minimumFractionDigits: 6 })}</td>
                  <td>{estoque ? Number(estoque.disponivel).toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="sim-tab" type="button" onClick={() => onEditar(produto)}>Editar</button>
                    <button className="sim-tab" type="button" onClick={() => onExcluir(produto)}>Excluir</button>
                  </td>
                </tr>
                );
              })}
              {!produtos.length && !carregando ? <tr><td colSpan="6" className="empty">Nenhum produto cadastrado.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
