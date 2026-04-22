import { useEffect, useMemo, useState } from 'react';
import {
  CANAL_OPTIONS,
  FAIXAS_PADRAO,
  METODO_ENVIO_OPTIONS,
  REGRA_CALCULO_OPTIONS,
  TIPO_CALCULO_OPTIONS,
  criarRascunhoVazio,
  exportarFretesExcel,
  exportarModeloFretes,
  exportarModeloRotas,
  exportarPacoteExcel,
  exportarRotasExcel,
  gerarFretesDoRascunho,
  gerarNomeFormatacao,
  importarFretesDeArquivo,
  importarRotasDeArquivo,
  obterFaixasAtivas,
  validarRascunho,
} from '../utils/formatacaoTabela';

const STORAGE_KEY = 'amdlog-formatacao-tabelas-v2';
const ETAPAS = ['Dados gerais', 'Rotas', 'Estrutura', 'Fretes', 'Revisão'];

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

function stepClass(active, index) {
  if (index === active) return 'active';
  if (index < active) return 'done';
  return '';
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resumoDraft(item) {
  return item.dadosGerais.nomeFormatacao || gerarNomeFormatacao(item.dadosGerais) || 'Sem nome';
}

export default function FormatacaoTabelasPage() {
  const draftsLoaded = loadDrafts();
  const [drafts, setDrafts] = useState(draftsLoaded);
  const [draft, setDraft] = useState(draftsLoaded[0] || criarRascunhoVazio());
  const [etapaAtual, setEtapaAtual] = useState(0);
  const [mensagem, setMensagem] = useState('');
  const [importandoRotas, setImportandoRotas] = useState(false);
  const [importandoFretes, setImportandoFretes] = useState(false);

  useEffect(() => saveDrafts(drafts), [drafts]);

  const nomeAutomatico = useMemo(() => gerarNomeFormatacao(draft.dadosGerais), [draft.dadosGerais]);
  const faixasAtivas = useMemo(
    () => obterFaixasAtivas(draft.dadosGerais.canal, draft.modeloFaixas, draft.faixasCustomizadas),
    [draft.dadosGerais.canal, draft.modeloFaixas, draft.faixasCustomizadas],
  );
  const validacao = useMemo(() => validarRascunho(draft), [draft]);

  const updateDraft = (updater) => {
    setDraft((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...next, atualizadoEm: new Date().toISOString() };
    });
  };

  const persistCurrentDraft = (nextDraft = draft, success = 'Rascunho salvo no navegador.') => {
    const updated = { ...nextDraft, atualizadoEm: new Date().toISOString() };
    setDraft(updated);
    setDrafts((current) => {
      const semAtual = current.filter((item) => item.id !== updated.id);
      return [updated, ...semAtual].slice(0, 20);
    });
    setMensagem(success);
  };

  const onCampoGeral = (campo, valor) => {
    updateDraft((current) => ({
      ...current,
      dadosGerais: {
        ...current.dadosGerais,
        [campo]: valor,
        nomeFormatacao:
          campo === 'nomeFormatacao'
            ? valor
            : current.dadosGerais.nomeFormatacao,
      },
    }));
  };

  const adicionarRota = () => {
    updateDraft((current) => ({
      ...current,
      rotas: [...current.rotas, { id: makeId('rota'), cotacao: '', ibgeDestino: '', cepInicial: '', cepFinal: '', prazo: '' }],
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
      fretes: current.fretes.filter((frete) => frete.rotaId !== id && frete.rotaFrete !== current.rotas.find((rota) => rota.id === id)?.cotacao),
    }));
  };

  const gerarEstruturaFretes = () => {
    updateDraft((current) => ({ ...current, fretes: gerarFretesDoRascunho(current) }));
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
      faixasCustomizadas: [...current.faixasCustomizadas, { id: makeId('faixa'), pesoMinimo: '', pesoLimite: '' }],
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

  const importarRotas = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportandoRotas(true);
    try {
      const rotas = await importarRotasDeArquivo(file);
      updateDraft((current) => ({ ...current, rotas }));
      setMensagem(`${rotas.length} rota(s) importadas.`);
    } catch (error) {
      setMensagem(`Falha ao importar rotas: ${error.message}`);
    } finally {
      setImportandoRotas(false);
      event.target.value = '';
    }
  };

  const importarFretes = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportandoFretes(true);
    try {
      const fretes = await importarFretesDeArquivo(file);
      updateDraft((current) => ({ ...current, fretes }));
      setMensagem(`${fretes.length} frete(s) importados.`);
    } catch (error) {
      setMensagem(`Falha ao importar fretes: ${error.message}`);
    } finally {
      setImportandoFretes(false);
      event.target.value = '';
    }
  };

  const novoRascunho = () => {
    setDraft(criarRascunhoVazio());
    setEtapaAtual(0);
    setMensagem('Novo rascunho iniciado.');
  };

  const carregarRascunho = (id) => {
    const selected = drafts.find((item) => item.id === id);
    if (!selected) return;
    setDraft(selected);
    setEtapaAtual(0);
    setMensagem(`Rascunho carregado: ${resumoDraft(selected)}.`);
  };

  const duplicarRascunho = () => {
    const clone = {
      ...draft,
      id: makeId('fmt'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      dadosGerais: {
        ...draft.dadosGerais,
        nomeFormatacao: `${resumoDraft(draft)} (cópia)`,
      },
    };
    persistCurrentDraft(clone, 'Rascunho duplicado com sucesso.');
  };

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <div className="amd-mini-brand">Módulo isolado • sem alterar o simulador atual</div>
          <h1>Formatação de Tabelas</h1>
          <p>
            Monte as rotas e os fretes em um ambiente separado. Aqui você gera modelo, importa planilhas e exporta no padrão atual sem mexer no que já funciona.
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
            {ETAPAS.map((etapa, index) => (
              <button key={etapa} type="button" className={`wizard-step ${stepClass(etapaAtual, index)}`.trim()} onClick={() => setEtapaAtual(index)}>
                <span className="wizard-step-index">{index + 1}</span>
                <span>{etapa}</span>
              </button>
            ))}
          </div>

          <div className="panel-title top-gap">Rascunhos</div>
          <div className="draft-list">
            {!drafts.length ? <div className="muted-box">Nenhum rascunho salvo.</div> : null}
            {drafts.map((item) => (
              <button key={item.id} type="button" className={`draft-item ${item.id === draft.id ? 'active' : ''}`} onClick={() => carregarRascunho(item.id)}>
                <strong>{resumoDraft(item)}</strong>
                <span>{item.dadosGerais.metodoEnvio || 'Sem método'}</span>
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
                <Field label="Nome da formatação">
                  <input value={draft.dadosGerais.nomeFormatacao} onChange={(e) => onCampoGeral('nomeFormatacao', e.target.value)} placeholder={nomeAutomatico || 'Será gerado automaticamente'} />
                </Field>
                <Field label="Transportadora">
                  <input value={draft.dadosGerais.transportadora} onChange={(e) => onCampoGeral('transportadora', e.target.value)} />
                </Field>
                <Field label="Origem / unidade">
                  <input value={draft.dadosGerais.origem} onChange={(e) => onCampoGeral('origem', e.target.value)} placeholder="Ex.: Itajaí" />
                </Field>
                <Field label="Código da unidade">
                  <input value={draft.dadosGerais.codigoUnidade} onChange={(e) => onCampoGeral('codigoUnidade', e.target.value)} placeholder="Ex.: 0001 - B2B" />
                </Field>
                <Field label="Canal">
                  <select value={draft.dadosGerais.canal} onChange={(e) => onCampoGeral('canal', e.target.value)}>
                    {CANAL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Método de envio">
                  <select value={draft.dadosGerais.metodoEnvio} onChange={(e) => onCampoGeral('metodoEnvio', e.target.value)}>
                    {METODO_ENVIO_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Regra de cálculo">
                  <select value={draft.dadosGerais.regraCalculo} onChange={(e) => onCampoGeral('regraCalculo', e.target.value)}>
                    {REGRA_CALCULO_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
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
                <Field label="IBGE origem (opcional)">
                  <input value={draft.dadosGerais.ibgeOrigem} onChange={(e) => onCampoGeral('ibgeOrigem', e.target.value)} placeholder="Pode ficar em branco por enquanto" />
                </Field>
                <Field label="Nome automático">
                  <div className="readonly-box">{nomeAutomatico || 'Preencha transportadora, origem e canal.'}</div>
                </Field>
              </div>
              <Field label="Observações">
                <textarea rows={5} value={draft.dadosGerais.observacoes} onChange={(e) => onCampoGeral('observacoes', e.target.value)} />
              </Field>
              <WizardNav etapaAtual={etapaAtual} onVoltar={() => setEtapaAtual((v) => Math.max(v - 1, 0))} onAvancar={() => setEtapaAtual((v) => Math.min(v + 1, ETAPAS.length - 1))} />
            </div>
          )}

          {etapaAtual === 1 && (
            <div className="step-grid">
              <div className="step-header-row">
                <div>
                  <div className="panel-title">Rotas</div>
                  <div className="helper-text">Se não preencher CEP inicial e final, a rota ficará preparada para considerar a base de IBGEs.</div>
                </div>
                <div className="step-actions wrap-actions compact-actions">
                  <button className="btn-secondary" type="button" onClick={() => exportarModeloRotas(draft)}>Exportar modelo</button>
                  <label className="btn-secondary file-btn">
                    Importar rotas
                    <input type="file" accept=".xlsx,.xls" onChange={importarRotas} hidden />
                  </label>
                  <button className="btn-primary" type="button" onClick={adicionarRota}>Adicionar rota</button>
                </div>
              </div>

              {importandoRotas ? <div className="muted-box">Importando rotas...</div> : null}
              <div className="grid-table-wrap">
                <div className="grid-table grid-rotas">
                  <div className="grid-head">Cotação</div>
                  <div className="grid-head">IBGE destino</div>
                  <div className="grid-head">CEP inicial</div>
                  <div className="grid-head">CEP final</div>
                  <div className="grid-head">Prazo</div>
                  <div className="grid-head">Ações</div>
                  {draft.rotas.map((rota) => (
                    <>
                      <input key={`${rota.id}-c`} value={rota.cotacao} onChange={(e) => atualizarRota(rota.id, 'cotacao', e.target.value)} />
                      <input key={`${rota.id}-i`} value={rota.ibgeDestino} onChange={(e) => atualizarRota(rota.id, 'ibgeDestino', e.target.value)} />
                      <input key={`${rota.id}-ci`} value={rota.cepInicial} onChange={(e) => atualizarRota(rota.id, 'cepInicial', e.target.value)} placeholder="Opcional" />
                      <input key={`${rota.id}-cf`} value={rota.cepFinal} onChange={(e) => atualizarRota(rota.id, 'cepFinal', e.target.value)} placeholder="Opcional" />
                      <input key={`${rota.id}-p`} value={rota.prazo} onChange={(e) => atualizarRota(rota.id, 'prazo', e.target.value)} />
                      <button key={`${rota.id}-r`} className="table-mini-btn danger" type="button" onClick={() => removerRota(rota.id)}>Excluir</button>
                    </>
                  ))}
                  {!draft.rotas.length ? <div className="empty-grid">Nenhuma rota adicionada ainda.</div> : null}
                </div>
              </div>
              <WizardNav etapaAtual={etapaAtual} onVoltar={() => setEtapaAtual((v) => Math.max(v - 1, 0))} onAvancar={() => setEtapaAtual((v) => Math.min(v + 1, ETAPAS.length - 1))} />
            </div>
          )}

          {etapaAtual === 2 && (
            <div className="step-grid">
              <div className="step-header-row">
                <div>
                  <div className="panel-title">Estrutura</div>
                  <div className="helper-text">Defina o tipo de cálculo e gere a estrutura base dos fretes.</div>
                </div>
                <div className="step-actions wrap-actions compact-actions">
                  <button className="btn-primary" type="button" onClick={gerarEstruturaFretes}>Gerar estrutura de fretes</button>
                </div>
              </div>

              <div className="structure-boxes">
                <div className="soft-box">
                  <div className="soft-box-title">Tipo atual</div>
                  <div className="soft-box-value">{draft.dadosGerais.tipoCalculo === 'percentual' ? 'Percentual' : 'Faixa de peso'}</div>
                </div>
                <div className="soft-box">
                  <div className="soft-box-title">Modelo de faixas</div>
                  <select value={draft.modeloFaixas} onChange={(e) => updateDraft((current) => ({ ...current, modeloFaixas: e.target.value }))}>
                    <option value="padrao-canal">Faixa padrão do canal</option>
                    <option value="customizado">Faixas customizadas</option>
                  </select>
                </div>
              </div>

              {draft.dadosGerais.tipoCalculo === 'faixa' && (
                <div className="faixas-box">
                  <div className="panel-title">Faixas de peso</div>
                  <div className="helper-text">Você pode usar o padrão do canal ou montar faixas customizadas.</div>
                  <div className="grid-table grid-faixas">
                    <div className="grid-head">Peso mínimo</div>
                    <div className="grid-head">Peso limite</div>
                    <div className="grid-head">Ações</div>
                    {(draft.modeloFaixas === 'customizado' ? draft.faixasCustomizadas : faixasAtivas).map((faixa) => (
                      <>
                        <input key={`${faixa.id}-min`} value={faixa.pesoMinimo} onChange={(e) => atualizarFaixa(faixa.id, 'pesoMinimo', e.target.value)} disabled={draft.modeloFaixas !== 'customizado'} />
                        <input key={`${faixa.id}-max`} value={faixa.pesoLimite} onChange={(e) => atualizarFaixa(faixa.id, 'pesoLimite', e.target.value)} disabled={draft.modeloFaixas !== 'customizado'} />
                        {draft.modeloFaixas === 'customizado'
                          ? <button key={`${faixa.id}-del`} className="table-mini-btn danger" type="button" onClick={() => removerFaixa(faixa.id)}>Excluir</button>
                          : <div key={`${faixa.id}-tag`} className="muted-chip">Padrão</div>}
                      </>
                    ))}
                  </div>
                  {draft.modeloFaixas === 'customizado' ? <button className="btn-secondary top-gap-small" type="button" onClick={adicionarFaixa}>Adicionar faixa</button> : null}
                  <div className="helper-text top-gap-small">Padrões carregados para {draft.dadosGerais.canal}: {(FAIXAS_PADRAO[draft.dadosGerais.canal] || []).length} faixa(s).</div>
                </div>
              )}
              <WizardNav etapaAtual={etapaAtual} onVoltar={() => setEtapaAtual((v) => Math.max(v - 1, 0))} onAvancar={() => setEtapaAtual((v) => Math.min(v + 1, ETAPAS.length - 1))} />
            </div>
          )}

          {etapaAtual === 3 && (
            <div className="step-grid">
              <div className="step-header-row">
                <div>
                  <div className="panel-title">Fretes</div>
                  <div className="helper-text">Você pode exportar o modelo para preencher fora do sistema ou importar a planilha pronta.</div>
                </div>
                <div className="step-actions wrap-actions compact-actions">
                  <button className="btn-secondary" type="button" onClick={() => exportarModeloFretes(draft)}>Exportar modelo</button>
                  <label className="btn-secondary file-btn">
                    Importar fretes
                    <input type="file" accept=".xlsx,.xls" onChange={importarFretes} hidden />
                  </label>
                  <button className="btn-primary" type="button" onClick={gerarEstruturaFretes}>Gerar linhas automáticas</button>
                </div>
              </div>

              {importandoFretes ? <div className="muted-box">Importando fretes...</div> : null}
              <div className="grid-table-wrap">
                <div className="grid-table grid-fretes">
                  <div className="grid-head">Rota do frete</div>
                  <div className="grid-head">Peso mínimo</div>
                  <div className="grid-head">Peso limite</div>
                  <div className="grid-head">Excesso de peso</div>
                  <div className="grid-head">Taxa aplicada</div>
                  <div className="grid-head">Frete percentual</div>
                  <div className="grid-head">Frete mínimo</div>
                  {draft.fretes.map((frete) => (
                    <>
                      <input key={`${frete.id}-rota`} value={frete.rotaFrete} onChange={(e) => atualizarFrete(frete.id, 'rotaFrete', e.target.value)} />
                      <input key={`${frete.id}-pmin`} value={frete.pesoMinimo} onChange={(e) => atualizarFrete(frete.id, 'pesoMinimo', e.target.value)} />
                      <input key={`${frete.id}-plim`} value={frete.pesoLimite} onChange={(e) => atualizarFrete(frete.id, 'pesoLimite', e.target.value)} />
                      <input key={`${frete.id}-exc`} value={frete.excessoPeso} onChange={(e) => atualizarFrete(frete.id, 'excessoPeso', e.target.value)} />
                      <input key={`${frete.id}-taxa`} value={frete.taxaAplicada} onChange={(e) => atualizarFrete(frete.id, 'taxaAplicada', e.target.value)} />
                      <input key={`${frete.id}-perc`} value={frete.fretePercentual} onChange={(e) => atualizarFrete(frete.id, 'fretePercentual', e.target.value)} />
                      <input key={`${frete.id}-min`} value={frete.freteMinimo} onChange={(e) => atualizarFrete(frete.id, 'freteMinimo', e.target.value)} />
                    </>
                  ))}
                  {!draft.fretes.length ? <div className="empty-grid">Nenhum frete gerado ou importado ainda.</div> : null}
                </div>
              </div>
              <WizardNav etapaAtual={etapaAtual} onVoltar={() => setEtapaAtual((v) => Math.max(v - 1, 0))} onAvancar={() => setEtapaAtual((v) => Math.min(v + 1, ETAPAS.length - 1))} />
            </div>
          )}

          {etapaAtual === 4 && (
            <div className="step-grid">
              <div className="panel-title">Revisão</div>
              <div className="review-grid">
                <div className="review-card review-ok">
                  <div className="review-title">Resumo</div>
                  <div className="review-line"><strong>Formatação:</strong> {resumoDraft(draft)}</div>
                  <div className="review-line"><strong>Rotas:</strong> {draft.rotas.length}</div>
                  <div className="review-line"><strong>Fretes:</strong> {draft.fretes.length}</div>
                  <div className="review-line"><strong>Tipo:</strong> {draft.dadosGerais.tipoCalculo === 'percentual' ? 'Percentual' : 'Faixa de peso'}</div>
                </div>
                <div className="review-card review-alert">
                  <div className="review-title">Erros</div>
                  {validacao.erros.length ? validacao.erros.map((erro) => <div key={erro} className="review-line">• {erro}</div>) : <div className="review-line">Nenhum erro crítico.</div>}
                </div>
                <div className="review-card review-warn">
                  <div className="review-title">Alertas</div>
                  {validacao.alertas.length ? validacao.alertas.map((alerta) => <div key={alerta} className="review-line">• {alerta}</div>) : <div className="review-line">Nenhum alerta.</div>}
                </div>
              </div>

              <div className="step-actions wrap-actions top-gap-small">
                <button className="btn-secondary" type="button" onClick={() => exportarRotasExcel(draft)}>Exportar rotas</button>
                <button className="btn-secondary" type="button" onClick={() => exportarFretesExcel(draft)}>Exportar fretes</button>
                <button className="btn-primary" type="button" onClick={() => exportarPacoteExcel(draft)}>Exportar pacote completo</button>
              </div>
              <WizardNav etapaAtual={etapaAtual} onVoltar={() => setEtapaAtual((v) => Math.max(v - 1, 0))} onAvancar={() => setEtapaAtual((v) => Math.min(v + 1, ETAPAS.length - 1))} disableNext />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field-block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function WizardNav({ etapaAtual, onVoltar, onAvancar, disableNext = false }) {
  return (
    <div className="wizard-nav">
      <button className="btn-secondary" type="button" onClick={onVoltar} disabled={etapaAtual === 0}>Voltar</button>
      <button className="btn-primary" type="button" onClick={onAvancar} disabled={disableNext}>Avançar</button>
    </div>
  );
}
