import { useEffect, useMemo, useState } from 'react';
import {
  CANAL_OPTIONS,
  TIPO_CALCULO_OPTIONS,
  criarRascunhoVazio,
  exportarFretesExcel,
  exportarPacoteExcel,
  exportarRotasExcel,
  gerarFretesDoRascunho,
  importarRotasDeArquivo,
  obterFaixasAtivas,
  validarRascunho,
} from '../utils/formatacaoTabela';

const STORAGE_KEY = 'amdlog-formatacao-tabelas-v1';

function loadDrafts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function etapaClass(indiceAtual, indiceEtapa) {
  if (indiceEtapa === indiceAtual) return 'active';
  if (indiceEtapa < indiceAtual) return 'done';
  return '';
}

const ETAPAS = ['Dados gerais', 'Rotas', 'Estrutura', 'Fretes', 'Revisão'];

export default function FormatacaoTabelasPage() {
  const [drafts, setDrafts] = useState(loadDrafts);
  const [draft, setDraft] = useState(() => loadDrafts()[0] || criarRascunhoVazio());
  const [etapaAtual, setEtapaAtual] = useState(0);
  const [mensagem, setMensagem] = useState('');
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  const validacao = useMemo(() => validarRascunho(draft), [draft]);
  const faixasAtivas = useMemo(
    () => obterFaixasAtivas(draft.dadosGerais.canal, draft.modeloFaixas, draft.faixasCustomizadas),
    [draft.dadosGerais.canal, draft.modeloFaixas, draft.faixasCustomizadas],
  );

  const updateDraft = (updater) => {
    setDraft((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...next, atualizadoEm: new Date().toISOString() };
    });
  };

  const persistCurrentDraft = (nextDraft = draft) => {
    setDrafts((current) => {
      const semAtual = current.filter((item) => item.id !== nextDraft.id);
      return [{ ...nextDraft, atualizadoEm: new Date().toISOString() }, ...semAtual].slice(0, 20);
    });
    setMensagem('Rascunho salvo no navegador.');
  };

  const onCampoGeral = (campo, valor) => {
    updateDraft((current) => ({
      ...current,
      dadosGerais: { ...current.dadosGerais, [campo]: valor },
    }));
  };

  const adicionarRota = () => {
    updateDraft((current) => ({
      ...current,
      rotas: [
        ...current.rotas,
        {
          id: `rota-${Date.now()}-${current.rotas.length}`,
          cotacao: '',
          ibgeOrigem: '',
          ibgeDestino: '',
          cepInicial: '',
          cepFinal: '',
          prazo: '',
        },
      ],
    }));
  };

  const atualizarRota = (id, campo, valor) => {
    updateDraft((current) => ({
      ...current,
      rotas: current.rotas.map((rota) => (rota.id === id ? { ...rota, [campo]: valor } : rota)),
    }));
  };

  const removerRota = (id) => {
    updateDraft((current) => ({
      ...current,
      rotas: current.rotas.filter((rota) => rota.id !== id),
      fretes: current.fretes.filter((frete) => frete.rotaId !== id),
    }));
  };

  const gerarEstruturaFretes = () => {
    updateDraft((current) => ({
      ...current,
      fretes: gerarFretesDoRascunho(current),
    }));
    setMensagem('Estrutura de fretes gerada com base nas rotas e no tipo de cálculo.');
  };

  const atualizarFrete = (id, campo, valor) => {
    updateDraft((current) => ({
      ...current,
      fretes: current.fretes.map((frete) => (frete.id === id ? { ...frete, [campo]: valor } : frete)),
    }));
  };

  const adicionarFaixa = () => {
    updateDraft((current) => ({
      ...current,
      modeloFaixas: 'customizado',
      faixasCustomizadas: [
        ...current.faixasCustomizadas,
        { id: `faixa-${Date.now()}-${current.faixasCustomizadas.length}`, pesoMinimo: '', pesoLimite: '' },
      ],
    }));
  };

  const atualizarFaixa = (id, campo, valor) => {
    updateDraft((current) => ({
      ...current,
      modeloFaixas: 'customizado',
      faixasCustomizadas: current.faixasCustomizadas.map((faixa) => (faixa.id === id ? { ...faixa, [campo]: valor } : faixa)),
    }));
  };

  const removerFaixa = (id) => {
    updateDraft((current) => ({
      ...current,
      faixasCustomizadas: current.faixasCustomizadas.filter((faixa) => faixa.id !== id),
    }));
  };

  const importarArquivo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportando(true);
    try {
      const rotas = await importarRotasDeArquivo(file);
      updateDraft((current) => ({ ...current, rotas }));
      setMensagem(`${rotas.length} rota(s) importadas do arquivo.`);
    } catch (error) {
      setMensagem(`Falha ao importar arquivo: ${error.message}`);
    } finally {
      setImportando(false);
      event.target.value = '';
    }
  };

  const novoRascunho = () => {
    const novo = criarRascunhoVazio();
    setDraft(novo);
    setEtapaAtual(0);
    setMensagem('Novo rascunho iniciado.');
  };

  const carregarRascunho = (id) => {
    const encontrado = drafts.find((item) => item.id === id);
    if (!encontrado) return;
    setDraft(encontrado);
    setMensagem(`Rascunho carregado: ${encontrado.dadosGerais.nomeTabela || encontrado.dadosGerais.transportadora || 'Sem nome'}.`);
  };

  const duplicarRascunho = () => {
    const clone = {
      ...draft,
      id: `fmt-${Date.now()}`,
      dadosGerais: {
        ...draft.dadosGerais,
        nomeTabela: draft.dadosGerais.nomeTabela ? `${draft.dadosGerais.nomeTabela} (cópia)` : '',
      },
    };
    setDraft(clone);
    persistCurrentDraft(clone);
  };

  const podeAvancar = etapaAtual < ETAPAS.length - 1;
  const podeVoltar = etapaAtual > 0;

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <div className="amd-mini-brand">Módulo isolado • sem alterar o fluxo atual</div>
          <h1>Formatação de Tabelas</h1>
          <p>
            Monte tabelas de rotas e fretes em um ambiente separado, gere os arquivos padrão e só decida depois
            se quer incluir no sistema principal.
          </p>
        </div>
        <div className="actions-right wrap-actions">
          <button className="btn-secondary" onClick={novoRascunho}>Novo rascunho</button>
          <button className="btn-secondary" onClick={duplicarRascunho}>Duplicar</button>
          <button className="btn-primary" onClick={() => persistCurrentDraft()}>Salvar rascunho</button>
        </div>
      </div>

      {mensagem ? <div className="info-card"><div className="info-text">{mensagem}</div></div> : null}

      <div className="formatacao-layout">
        <aside className="panel-card formatacao-sidebar">
          <div className="panel-title">Etapas</div>
          <div className="wizard-steps">
            {ETAPAS.map((item, index) => (
              <button
                key={item}
                type="button"
                className={`wizard-step ${etapaClass(etapaAtual, index)}`.trim()}
                onClick={() => setEtapaAtual(index)}
              >
                <span className="wizard-step-index">{index + 1}</span>
                <span>{item}</span>
              </button>
            ))}
          </div>

          <div className="panel-title" style={{ marginTop: 18 }}>Rascunhos</div>
          <div className="draft-list">
            {drafts.length === 0 ? <div className="muted-box">Nenhum rascunho salvo ainda.</div> : null}
            {drafts.map((item) => (
              <button key={item.id} type="button" className="draft-item" onClick={() => carregarRascunho(item.id)}>
                <strong>{item.dadosGerais.nomeTabela || item.dadosGerais.transportadora || 'Sem nome'}</strong>
                <span>{item.dadosGerais.canal || 'Canal não informado'}</span>
                <span>{new Date(item.atualizadoEm || item.criadoEm).toLocaleString('pt-BR')}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel-card formatacao-main">
          {etapaAtual === 0 && (
            <div className="step-grid">
              <div className="panel-title">Dados gerais</div>
              <div className="grid-2">
                <Field label="Nome da tabela">
                  <input value={draft.dadosGerais.nomeTabela} onChange={(e) => onCampoGeral('nomeTabela', e.target.value)} />
                </Field>
                <Field label="Transportadora">
                  <input value={draft.dadosGerais.transportadora} onChange={(e) => onCampoGeral('transportadora', e.target.value)} />
                </Field>
                <Field label="Código da unidade / origem">
                  <input value={draft.dadosGerais.codigoUnidade} onChange={(e) => onCampoGeral('codigoUnidade', e.target.value)} />
                </Field>
                <Field label="Canal">
                  <select value={draft.dadosGerais.canal} onChange={(e) => onCampoGeral('canal', e.target.value)}>
                    {CANAL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Método de envio">
                  <input value={draft.dadosGerais.metodoEnvio} onChange={(e) => onCampoGeral('metodoEnvio', e.target.value)} />
                </Field>
                <Field label="Regra de cálculo">
                  <input value={draft.dadosGerais.regraCalculo} onChange={(e) => onCampoGeral('regraCalculo', e.target.value)} />
                </Field>
                <Field label="Tipo de cálculo">
                  <select value={draft.dadosGerais.tipoCalculo} onChange={(e) => onCampoGeral('tipoCalculo', e.target.value)}>
                    {TIPO_CALCULO_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Vigência inicial">
                  <input type="date" value={draft.dadosGerais.vigenciaInicial} onChange={(e) => onCampoGeral('vigenciaInicial', e.target.value)} />
                </Field>
                <Field label="Vigência final">
                  <input type="date" value={draft.dadosGerais.vigenciaFinal} onChange={(e) => onCampoGeral('vigenciaFinal', e.target.value)} />
                </Field>
                <Field label="Observações" className="field-span-2">
                  <textarea rows="4" value={draft.dadosGerais.observacoes} onChange={(e) => onCampoGeral('observacoes', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {etapaAtual === 1 && (
            <div className="step-grid">
              <div className="section-head-row">
                <div className="panel-title">Rotas</div>
                <div className="actions-right wrap-actions">
                  <label className="btn-secondary file-btn">
                    {importando ? 'Importando...' : 'Importar Excel'}
                    <input type="file" accept=".xlsx,.xls" onChange={importarArquivo} hidden />
                  </label>
                  <button className="btn-primary" onClick={adicionarRota}>Adicionar rota</button>
                </div>
              </div>
              <div className="table-responsive">
                <table className="custom-table compact-table">
                  <thead>
                    <tr>
                      <th>Cotação</th>
                      <th>IBGE origem</th>
                      <th>IBGE destino</th>
                      <th>CEP inicial</th>
                      <th>CEP final</th>
                      <th>Prazo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.rotas.map((rota) => (
                      <tr key={rota.id}>
                        <td><input value={rota.cotacao} onChange={(e) => atualizarRota(rota.id, 'cotacao', e.target.value)} /></td>
                        <td><input value={rota.ibgeOrigem} onChange={(e) => atualizarRota(rota.id, 'ibgeOrigem', e.target.value)} /></td>
                        <td><input value={rota.ibgeDestino} onChange={(e) => atualizarRota(rota.id, 'ibgeDestino', e.target.value)} /></td>
                        <td><input value={rota.cepInicial} onChange={(e) => atualizarRota(rota.id, 'cepInicial', e.target.value)} /></td>
                        <td><input value={rota.cepFinal} onChange={(e) => atualizarRota(rota.id, 'cepFinal', e.target.value)} /></td>
                        <td><input value={rota.prazo} onChange={(e) => atualizarRota(rota.id, 'prazo', e.target.value)} /></td>
                        <td><button className="btn-link" onClick={() => removerRota(rota.id)}>Remover</button></td>
                      </tr>
                    ))}
                    {!draft.rotas.length && (
                      <tr>
                        <td colSpan="7"><div className="muted-box">Nenhuma rota adicionada ainda.</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {etapaAtual === 2 && (
            <div className="step-grid">
              <div className="panel-title">Estrutura de fretes</div>
              <div className="info-card">
                <div className="info-text">
                  <strong>Tipo atual:</strong> {draft.dadosGerais.tipoCalculo === 'percentual' ? 'Percentual' : 'Faixa de peso'}
                </div>
                <div className="info-text">
                  {draft.dadosGerais.tipoCalculo === 'percentual'
                    ? 'Será criada uma linha de frete para cada cotação/rota cadastrada.'
                    : 'Serão replicadas todas as faixas para cada cotação/rota cadastrada.'}
                </div>
              </div>

              {draft.dadosGerais.tipoCalculo === 'faixa' && (
                <>
                  <div className="grid-2">
                    <Field label="Modelo de faixas">
                      <select value={draft.modeloFaixas} onChange={(e) => updateDraft((current) => ({ ...current, modeloFaixas: e.target.value }))}>
                        <option value="padrao-canal">Padrão do canal</option>
                        <option value="customizado">Customizado</option>
                      </select>
                    </Field>
                    <div className="field-box align-end">
                      <button className="btn-secondary" onClick={adicionarFaixa}>Adicionar faixa customizada</button>
                    </div>
                  </div>

                  <div className="table-responsive">
                    <table className="custom-table compact-table">
                      <thead>
                        <tr>
                          <th>Peso mínimo</th>
                          <th>Peso limite</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {faixasAtivas.map((faixa, index) => {
                          const isCustom = draft.modeloFaixas === 'customizado';
                          return (
                            <tr key={faixa.id || index}>
                              <td>
                                <input
                                  value={faixa.pesoMinimo}
                                  disabled={!isCustom}
                                  onChange={(e) => atualizarFaixa(faixa.id, 'pesoMinimo', e.target.value)}
                                />
                              </td>
                              <td>
                                <input
                                  value={faixa.pesoLimite}
                                  disabled={!isCustom}
                                  onChange={(e) => atualizarFaixa(faixa.id, 'pesoLimite', e.target.value)}
                                />
                              </td>
                              <td>
                                {isCustom ? <button className="btn-link" onClick={() => removerFaixa(faixa.id)}>Remover</button> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="actions-right wrap-actions">
                <button className="btn-primary" onClick={gerarEstruturaFretes}>Gerar estrutura de fretes</button>
              </div>
            </div>
          )}

          {etapaAtual === 3 && (
            <div className="step-grid">
              <div className="section-head-row">
                <div className="panel-title">Fretes gerados</div>
                <div className="info-text">{draft.fretes.length} linha(s)</div>
              </div>
              <div className="table-responsive">
                <table className="custom-table compact-table">
                  <thead>
                    <tr>
                      <th>Rota</th>
                      <th>Peso mínimo</th>
                      <th>Peso limite</th>
                      <th>Excesso de peso</th>
                      <th>Taxa aplicada</th>
                      <th>Frete percentual</th>
                      <th>Frete mínimo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.fretes.map((frete) => (
                      <tr key={frete.id}>
                        <td>{frete.rotaFrete}</td>
                        <td><input value={frete.pesoMinimo} onChange={(e) => atualizarFrete(frete.id, 'pesoMinimo', e.target.value)} /></td>
                        <td><input value={frete.pesoLimite} onChange={(e) => atualizarFrete(frete.id, 'pesoLimite', e.target.value)} /></td>
                        <td><input value={frete.excessoPeso} onChange={(e) => atualizarFrete(frete.id, 'excessoPeso', e.target.value)} /></td>
                        <td><input value={frete.taxaAplicada} onChange={(e) => atualizarFrete(frete.id, 'taxaAplicada', e.target.value)} /></td>
                        <td><input value={frete.fretePercentual} onChange={(e) => atualizarFrete(frete.id, 'fretePercentual', e.target.value)} /></td>
                        <td><input value={frete.freteMinimo} onChange={(e) => atualizarFrete(frete.id, 'freteMinimo', e.target.value)} /></td>
                      </tr>
                    ))}
                    {!draft.fretes.length && (
                      <tr>
                        <td colSpan="7"><div className="muted-box">Gere a estrutura primeiro.</div></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {etapaAtual === 4 && (
            <div className="step-grid">
              <div className="panel-title">Revisão e exportação</div>
              <div className="review-grid">
                <div className="review-box ok-box">
                  <strong>Resumo</strong>
                  <span>Transportadora: {draft.dadosGerais.transportadora || 'Não informada'}</span>
                  <span>Origem: {draft.dadosGerais.codigoUnidade || 'Não informada'}</span>
                  <span>Canal: {draft.dadosGerais.canal}</span>
                  <span>Rotas: {draft.rotas.length}</span>
                  <span>Fretes: {draft.fretes.length}</span>
                </div>
                <div className="review-box warn-box">
                  <strong>Erros</strong>
                  {validacao.erros.length ? validacao.erros.map((item) => <span key={item}>{item}</span>) : <span>Nenhum erro crítico.</span>}
                </div>
                <div className="review-box soft-box">
                  <strong>Alertas</strong>
                  {validacao.alertas.length ? validacao.alertas.map((item) => <span key={item}>{item}</span>) : <span>Nenhum alerta encontrado.</span>}
                </div>
              </div>

              <div className="actions-right wrap-actions">
                <button className="btn-secondary" onClick={() => exportarRotasExcel(draft)}>Exportar rotas</button>
                <button className="btn-secondary" onClick={() => exportarFretesExcel(draft)}>Exportar fretes</button>
                <button className="btn-primary" onClick={() => exportarPacoteExcel(draft)}>Exportar pacote completo</button>
              </div>

              <div className="info-card">
                <div className="info-text">
                  Esta versão é isolada. Ela <strong>não publica</strong> na base principal e não altera o que já está funcionando.
                </div>
              </div>
            </div>
          )}

          <div className="wizard-footer">
            <button className="btn-secondary" onClick={() => podeVoltar && setEtapaAtual((value) => value - 1)} disabled={!podeVoltar}>Voltar</button>
            <button className="btn-primary" onClick={() => podeAvancar && setEtapaAtual((value) => value + 1)} disabled={!podeAvancar}>Avançar</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`field-box ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}
