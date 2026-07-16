import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  carregarMatrizIcmsUf,
  carregarMatrizIcmsUfCentralizada,
  modeloMatrizIcmsUf,
  normalizarLinhaIcms,
  salvarMatrizIcmsUfCentralizada,
  UFS_BR,
} from '../utils/icmsUfMatrix';
import { carregarOpcoesSimuladorDb } from '../services/freteDatabaseService';

function fmtN(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exportarXlsx(linhas, nome) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'ICMS UF');
  XLSX.writeFile(wb, nome);
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function parsePercentual(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const parsed = Number(String(valor).replace('%', '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function linhasDaPlanilhaIcms(ws) {
  const matrizDireta = XLSX.utils.sheet_to_json(ws, { defval: '' }).map(normalizarLinhaIcms).filter(Boolean);
  if (matrizDireta.length) return matrizDireta;

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizarTexto(cell) === 'UF') && row.some((cell) => normalizarTexto(cell).includes('ALIQUOTA INTERNA')));
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizarTexto);
  const ufIndex = header.findIndex((cell) => cell === 'UF');
  const aliquotaIndex = header.findIndex((cell) => cell.includes('ALIQUOTA INTERNA'));
  const obsIndex = header.findIndex((cell) => cell.includes('OBS'));
  const linhas = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const ufOrigem = String(row[ufIndex] || '').trim().toUpperCase();
    const aliquota = parsePercentual(row[aliquotaIndex]);
    if (!UFS_BR.includes(ufOrigem) || aliquota <= 0) continue;
    UFS_BR.forEach((ufDestino) => {
      linhas.push({
        ufOrigem,
        ufDestino,
        aliquota,
        observacao: String(row[obsIndex] || 'Alíquota interna da UF de origem').trim(),
      });
    });
  }
  return linhas;
}

export default function IcmsUfPage() {
  const [linhas, setLinhas] = useState(() => carregarMatrizIcmsUf());
  const [mensagem, setMensagem] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [filtroTransportadora, setFiltroTransportadora] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [opcoesCadastro, setOpcoesCadastro] = useState({ transportadoras: [], origensPorTransportadora: {}, canaisPorTransportadora: {} });
  const [buscaTransportadora, setBuscaTransportadora] = useState('');
  const [mostrarSugestoesTransp, setMostrarSugestoesTransp] = useState(false);
  const [excecao, setExcecao] = useState({
    transportadora: '',
    cidadeOrigem: '',
    canal: '',
    ufOrigem: 'SC',
    ufDestino: 'SP',
    aliquota: 17,
    observacao: '',
  });

  useEffect(() => {
    let ativo = true;
    carregarMatrizIcmsUfCentralizada()
      .then((resposta) => {
        if (!ativo) return;
        setLinhas(resposta.linhas || []);
        if (resposta.mensagem) setMensagem(resposta.mensagem);
      })
      .catch((error) => {
        if (ativo) setMensagem(`Não foi possível sincronizar matriz ICMS: ${error.message || error}`);
      });

    carregarOpcoesSimuladorDb()
      .then((opcoes) => {
        if (ativo) setOpcoesCadastro(opcoes || { transportadoras: [], origensPorTransportadora: {}, canaisPorTransportadora: {} });
      })
      .catch(() => {
        if (ativo) setOpcoesCadastro({ transportadoras: [], origensPorTransportadora: {}, canaisPorTransportadora: {} });
      });
    return () => { ativo = false; };
  }, []);

  const transportadorasCadastro = opcoesCadastro.transportadoras || [];
  const origensCadastro = excecao.transportadora ? (opcoesCadastro.origensPorTransportadora?.[excecao.transportadora] || []) : [];
  const canaisCadastro = excecao.transportadora ? (opcoesCadastro.canaisPorTransportadora?.[excecao.transportadora] || []) : [];
  const sugestoesTransportadora = useMemo(() => {
    const termo = normalizarTexto(buscaTransportadora || excecao.transportadora);
    return transportadorasCadastro
      .filter((nome) => !termo || normalizarTexto(nome).includes(termo))
      .slice(0, 12);
  }, [transportadorasCadastro, buscaTransportadora, excecao.transportadora]);

  const transportadorasSalvas = useMemo(() => Array.from(new Set(linhas
    .map((row) => row.transportadora)
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR')), [linhas]);

  const filtradas = useMemo(() => linhas.filter((row) => (
    (!filtroTipo || (filtroTipo === 'base' ? !row.transportadora : !!row.transportadora))
    && (!filtroTransportadora || row.transportadora === filtroTransportadora)
    && (!filtroOrigem || row.ufOrigem === filtroOrigem)
    && (!filtroDestino || row.ufDestino === filtroDestino)
  )), [linhas, filtroTipo, filtroTransportadora, filtroOrigem, filtroDestino]);

  async function importarArquivo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const validas = wb.SheetNames.flatMap((name) => linhasDaPlanilhaIcms(wb.Sheets[name]));
      const resposta = await salvarMatrizIcmsUfCentralizada(validas);
      setLinhas(resposta.linhas);
      setMensagem(`Matriz importada: ${validas.length.toLocaleString('pt-BR')} linha(s) valida(s), ${resposta.linhas.length.toLocaleString('pt-BR')} combinação(ões) salva(s). ${resposta.mensagem || ''}`);
    } catch (error) {
      setMensagem(`Erro ao importar matriz: ${error.message}`);
    }
  }

  async function atualizarLinha(index, campo, valor) {
    const alvo = filtradas[index];
    const origemIndex = linhas.findIndex((row) => (
      row.ufOrigem === alvo.ufOrigem
      && row.ufDestino === alvo.ufDestino
      && String(row.transportadora || '') === String(alvo.transportadora || '')
      && String(row.cidadeOrigem || '') === String(alvo.cidadeOrigem || '')
      && String(row.canal || '') === String(alvo.canal || '')
    ));
    if (origemIndex < 0) return;
    const prox = linhas.map((row, idx) => (idx === origemIndex ? { ...row, [campo]: campo === 'aliquota' ? Number(valor || 0) : valor } : row));
    const resposta = await salvarMatrizIcmsUfCentralizada(prox);
    setLinhas(resposta.linhas);
    setMensagem(resposta.mensagem || 'Matriz ICMS atualizada.');
  }

  async function removerLinha(index) {
    const alvo = filtradas[index];
    if (!alvo) return;
    const descricao = `${alvo.transportadora || 'Base geral'} ${alvo.cidadeOrigem ? `/ ${alvo.cidadeOrigem}` : ''} ${alvo.canal ? `/ ${alvo.canal}` : ''} ${alvo.ufOrigem} -> ${alvo.ufDestino}`;
    if (!window.confirm(`Apagar esta linha?\n${descricao}`)) return;
    const prox = linhas.filter((row) => row !== alvo);
    const resposta = await salvarMatrizIcmsUfCentralizada(prox);
    setLinhas(resposta.linhas);
    setMensagem(`Linha apagada: ${descricao}. ${resposta.mensagem || ''}`);
  }

  function alterarExcecao(campo, valor) {
    setExcecao((prev) => (
      campo === 'transportadora'
        ? { ...prev, transportadora: valor, cidadeOrigem: '', canal: '' }
        : { ...prev, [campo]: valor }
    ));
  }

  function selecionarTransportadora(nome) {
    setExcecao((prev) => ({ ...prev, transportadora: nome, cidadeOrigem: '', canal: '' }));
    setBuscaTransportadora(nome);
    setMostrarSugestoesTransp(false);
  }

  async function adicionarExcecao() {
    const normalizada = normalizarLinhaIcms({
      TRANSPORTADORA: excecao.transportadora,
      CIDADE_ORIGEM: excecao.cidadeOrigem,
      CANAL: excecao.canal,
      UF_ORIGEM: excecao.ufOrigem,
      UF_DESTINO: excecao.ufDestino,
      ALIQUOTA: excecao.aliquota,
      OBSERVACAO: excecao.observacao || 'Exceção cadastrada manualmente',
    });
    if (!normalizada?.transportadora || !normalizada?.ufOrigem || !normalizada?.ufDestino || Number(normalizada?.aliquota) <= 0) {
      setMensagem('Informe transportadora, UF origem, UF destino e alíquota para adicionar a exceção.');
      return;
    }
    const resposta = await salvarMatrizIcmsUfCentralizada([...linhas, normalizada]);
    setLinhas(resposta.linhas);
    setMensagem(`Exceção salva: ${normalizada.transportadora} ${normalizada.cidadeOrigem ? `/ ${normalizada.cidadeOrigem}` : ''} ${normalizada.ufOrigem} -> ${normalizada.ufDestino} = ${fmtN(normalizada.aliquota)}%. ${resposta.mensagem || ''}`);
    setExcecao((prev) => ({ ...prev, transportadora: '', cidadeOrigem: '', canal: '', observacao: '' }));
  }

  async function limpar() {
    if (!window.confirm('Apagar toda a matriz ICMS UF salva neste navegador?')) return;
    localStorage.removeItem('central-fretes:icms-uf-matrix-v1');
    const resposta = await salvarMatrizIcmsUfCentralizada([]);
    setLinhas([]);
    setMensagem(`Matriz apagada. ${resposta.mensagem || ''}`);
  }

  return (
    <div className="page-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Base e cadastros</div>
        <h1>Matriz ICMS UF</h1>
        <p>Cadastre a base oficial por UF e, quando necessário, exceções por transportadora/origem/canal sem alterar a regra geral.</p>
      </div>

      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importação da matriz</div>
            <p>Colunas aceitas: TRANSPORTADORA, CIDADE_ORIGEM, CANAL, UF_ORIGEM, UF_DESTINO, ALIQUOTA e OBSERVACAO. Sem transportadora = base oficial geral.</p>
          </div>
          <div className="actions-right">
            <button className="btn-secondary" type="button" onClick={() => exportarXlsx(modeloMatrizIcmsUf(), 'modelo-icms-uf.xlsx')}>Baixar modelo</button>
            <button className="btn-secondary" type="button" onClick={() => exportarXlsx(linhas, 'matriz-icms-uf.xlsx')} disabled={!linhas.length}>Exportar atual</button>
            <label className="btn-primary file-button">
              Importar base
              <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={importarArquivo} hidden />
            </label>
            <button className="btn-secondary" type="button" onClick={limpar} disabled={!linhas.length}>Limpar</button>
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Adicionar exceção</div>
            <p>Use para casos descobertos na auditoria, sem mexer na base oficial geral.</p>
          </div>
          <button className="btn-primary" type="button" onClick={adicionarExcecao}>Incluir exceção</button>
        </div>
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Transportadora
            <div className="icms-transportadora-search">
              <input
                value={buscaTransportadora}
                onFocus={() => setMostrarSugestoesTransp(true)}
                onChange={(e) => {
                  setBuscaTransportadora(e.target.value);
                  alterarExcecao('transportadora', e.target.value);
                  setMostrarSugestoesTransp(true);
                }}
                placeholder="Digite para buscar a tabela"
              />
              {mostrarSugestoesTransp && (
                <div className="icms-transportadora-menu">
                  {sugestoesTransportadora.map((nome) => (
                    <button key={nome} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selecionarTransportadora(nome)}>
                      {nome}
                    </button>
                  ))}
                  {!sugestoesTransportadora.length ? <span>Nenhuma tabela encontrada</span> : null}
                </div>
              )}
            </div>
          </label>
          <label>Cidade origem
            {origensCadastro.length ? (
              <select value={excecao.cidadeOrigem} onChange={(e) => alterarExcecao('cidadeOrigem', e.target.value)}>
                <option value="">Todas</option>
                {origensCadastro.map((origem) => <option key={origem} value={origem}>{origem}</option>)}
              </select>
            ) : (
              <input value={excecao.cidadeOrigem} onChange={(e) => alterarExcecao('cidadeOrigem', e.target.value)} placeholder="Escolha a transportadora primeiro" />
            )}
          </label>
          <label>Canal
            <select value={excecao.canal} onChange={(e) => alterarExcecao('canal', e.target.value)}>
              <option value="">Todos</option>
              {(canaisCadastro.length ? canaisCadastro : ['B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA', 'A DEFINIR'])
                .map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          </label>
          <label>Alíquota %
            <input type="number" min="0" step="0.01" value={excecao.aliquota} onChange={(e) => alterarExcecao('aliquota', e.target.value)} />
          </label>
          <label>UF origem
            <select value={excecao.ufOrigem} onChange={(e) => alterarExcecao('ufOrigem', e.target.value)}>
              {UFS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </label>
          <label>UF destino
            <select value={excecao.ufDestino} onChange={(e) => alterarExcecao('ufDestino', e.target.value)}>
              {UFS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: 'span 2' }}>Observação
            <input value={excecao.observacao} onChange={(e) => alterarExcecao('observacao', e.target.value)} placeholder="Ex.: CT-e Translovato veio com 17%" />
          </label>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Combinações salvas</div>
            <span>{linhas.length.toLocaleString('pt-BR')} linha(s)</span>
          </div>
          <div className="actions-right">
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Tipo: todos</option>
              <option value="base">Base geral</option>
              <option value="excecao">Exceções</option>
            </select>
            <select value={filtroTransportadora} onChange={(e) => setFiltroTransportadora(e.target.value)}>
              <option value="">Transportadora: todas</option>
              {transportadorasSalvas.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
            </select>
            <select value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}>
              <option value="">Origem: todas</option>
              {UFS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
            <select value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)}>
              <option value="">Destino: todos</option>
              {UFS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr><th>Transportadora</th><th>Origem</th><th>Canal</th><th>UF origem</th><th>UF destino</th><th>Alíquota %</th><th>Observação</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {filtradas.map((row, index) => (
                <tr key={`${row.transportadora || 'GERAL'}-${row.cidadeOrigem || '-'}-${row.canal || '-'}-${row.ufOrigem}-${row.ufDestino}-${index}`}>
                  <td>{row.transportadora || <span style={{ color: '#94a3b8' }}>Base geral</span>}</td>
                  <td>{row.cidadeOrigem || '-'}</td>
                  <td>{row.canal || '-'}</td>
                  <td><strong>{row.ufOrigem}</strong></td>
                  <td><strong>{row.ufDestino}</strong></td>
                  <td style={{ maxWidth: 140 }}>
                    <input value={fmtN(row.aliquota)} onChange={(e) => atualizarLinha(index, 'aliquota', e.target.value)} />
                  </td>
                  <td><input value={row.observacao || ''} onChange={(e) => atualizarLinha(index, 'observacao', e.target.value)} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-secondary" type="button" onClick={() => removerLinha(index)}>Apagar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtradas.length ? <div className="empty-note">Importe a matriz ou baixe o modelo para preencher.</div> : null}
        </div>
      </section>
    </div>
  );
}
