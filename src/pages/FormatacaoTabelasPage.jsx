import { useEffect, useMemo, useRef, useState } from 'react';
import {
  METODOS_ENVIO,
  REGRAS_CALCULO,
  TIPOS_CALCULO,
  buscarIbgePorOrigem,
  carregarBaseIbge,
  carregarRascunhos,
  construirCadastroBase,
  criarFormularioInicial,
  encontrarOrigemExistente,
  encontrarTransportadoraExistente,
  exportarModeloFretes,
  exportarModeloQuebras,
  exportarModeloRotas,
  exportarPacoteCompleto,
  gerarFretesAutomaticos,
  importarBaseIbge,
  importarFretes,
  importarQuebras,
  importarRotas,
  montarNomeAutomatico,
  proximoCodigoOrigem,
  salvarRascunhos,
  validarFormacao,
} from '../utils/formatacaoTabela';

const ETAPAS = ['Dados gerais', 'Rotas', 'Quebra de Faixas', 'Fretes', 'Revisão'];
const MODOS_CADASTRO = [
  { value: 'existente', label: 'Usar cadastro existente' },
  { value: 'novo', label: 'Novo cadastro' },
];
const CANAIS = ['ATACADO', 'B2C'];

export default function FormatacaoTabelasPage({ transportadoras = [] }) {
  const [etapaAtual, setEtapaAtual] = useState(0);
  const [form, setForm] = useState(criarFormularioInicial());
  const [rascunhos, setRascunhos] = useState([]);
  const [baseIbge, setBaseIbge] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const inputRotasRef = useRef(null);
  const inputQuebrasRef = useRef(null);
  const inputFretesRef = useRef(null);
  const inputIbgeRef = useRef(null);

  useEffect(() => {
    setRascunhos(carregarRascunhos());
    setBaseIbge(carregarBaseIbge());
  }, []);

  const cadastroBase = useMemo(() => construirCadastroBase(transportadoras), [transportadoras]);

  const opcoesOrigem = useMemo(() => {
    const todas = cadastroBase.origens || [];
    if (form.transportadoraModo !== 'existente' || !form.transportadoraExistente) return todas;
    const filtradas = todas.filter((item) => item.transportadoras.includes(form.transportadoraExistente));
    return filtradas.length ? filtradas : todas;
  }, [cadastroBase, form.transportadoraModo, form.transportadoraExistente]);

  const transportadoraDuplicada = useMemo(
    () => form.transportadoraModo === 'novo' && !!encontrarTransportadoraExistente(cadastroBase, form.transportadora),
    [cadastroBase, form.transportadora, form.transportadoraModo],
  );

  const origemDuplicada = useMemo(
    () => form.origemModo === 'novo' && !!encontrarOrigemExistente(cadastroBase, form.origemNome, form.canal),
    [cadastroBase, form.canal, form.origemModo, form.origemNome],
  );

  useEffect(() => {
    if (form.transportadoraModo === 'existente') {
      setForm((atual) => {
        const proximoNome = atual.transportadoraExistente || '';
        if (atual.transportadora === proximoNome) return atual;
        return {
          ...atual,
          transportadora: proximoNome,
        };
      });
      return;
    }
    setForm((atual) => (atual.transportadoraExistente ? { ...atual, transportadoraExistente: '' } : atual));
  }, [form.transportadoraModo, form.transportadoraExistente]);

  useEffect(() => {
    if (form.origemModo === 'existente') {
      const selecionada = opcoesOrigem.find((item) => item.key === form.origemExistenteKey) || null;
      if (!selecionada) {
        setForm((atual) => {
          if (!atual.origemNome && !atual.codigoUnidade && !atual.origemIbge) return atual;
          return {
            ...atual,
            origemNome: '',
            codigoUnidade: '',
            origemIbge: '',
          };
        });
        return;
      }
      setForm((atual) => {
        if (atual.origemNome === selecionada.nome && atual.codigoUnidade === selecionada.codigo && atual.canal === selecionada.canal) return atual;
        return {
          ...atual,
          origemNome: selecionada.nome,
          codigoUnidade: selecionada.codigo,
          canal: selecionada.canal,
        };
      });
      return;
    }
    setForm((atual) => {
      const proximoCodigo = atual.codigoUnidade || proximoCodigoOrigem(cadastroBase);
      if (!atual.origemExistenteKey && atual.codigoUnidade === proximoCodigo) return atual;
      return {
        ...atual,
        origemExistenteKey: '',
        codigoUnidade: proximoCodigo,
      };
    });
  }, [cadastroBase, form.origemModo, form.origemExistenteKey, opcoesOrigem]);

  useEffect(() => {
    if (form.origemModo !== 'novo') return;
    setForm((atual) => {
      const proximoCodigo = proximoCodigoOrigem(cadastroBase);
      if (atual.codigoUnidade === proximoCodigo) return atual;
      return {
        ...atual,
        codigoUnidade: proximoCodigo,
      };
    });
  }, [cadastroBase, form.origemModo, form.origemNome, form.canal]);

  useEffect(() => {
    if (!form.nomeFormatacao?.trim()) {
      setForm((atual) => {
        const nomeAuto = montarNomeAutomatico(atual);
        if (atual.nomeFormatacao === nomeAuto) return atual;
        return { ...atual, nomeFormatacao: nomeAuto };
      });
    }
  }, [form.transportadora, form.origemNome, form.canal]);

  useEffect(() => {
    if (!baseIbge || !form.origemNome) return;
    const encontrado = buscarIbgePorOrigem(baseIbge, form.origemNome);
    setForm((atual) => {
      const proximoIbge = encontrado?.codigoMunicipioCompleto || atual.origemIbge || '';
      const mesmoResumo = JSON.stringify(atual.baseIbgeResumo || null) === JSON.stringify(baseIbge.resumo || null);
      if (atual.origemIbge === proximoIbge && mesmoResumo) return atual;
      return {
        ...atual,
        origemIbge: proximoIbge,
        baseIbgeResumo: baseIbge.resumo,
      };
    });
  }, [baseIbge, form.origemNome]);

  const validacaoBase = useMemo(() => validarFormacao(form), [form]);
  const validacao = useMemo(() => {
    const erros = [...validacaoBase.erros];
    const alertas = [...validacaoBase.alertas];
    if (transportadoraDuplicada) {
      erros.push('A transportadora digitada já existe no cadastro. Use a lista suspensa para evitar duplicidade.');
    }
    if (origemDuplicada) {
      erros.push('A origem digitada já existe para esse canal. Use a origem existente para reaproveitar o código já cadastrado.');
    }
    return { erros, alertas };
  }, [origemDuplicada, transportadoraDuplicada, validacaoBase]);

  const atualizarCampo = (campo, valor) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const salvarRascunhoAtual = () => {
    const atualizado = { ...form, atualizadoEm: new Date().toISOString() };
    const proximos = [atualizado, ...rascunhos.filter((item) => item.id !== atualizado.id)];
    setRascunhos(proximos);
    salvarRascunhos(proximos);
    setMensagem('Rascunho salvo com sucesso.');
    setErro('');
  };

  const carregarRascunho = (id) => {
    const item = rascunhos.find((draft) => draft.id === id);
    if (!item) return;
    setForm(item);
    setMensagem('Rascunho carregado.');
    setErro('');
  };

  const novoRascunho = () => {
    setForm(criarFormularioInicial());
    setEtapaAtual(0);
    setMensagem('Nova formatação iniciada.');
    setErro('');
  };

  const duplicarRascunho = () => {
    setForm((atual) => ({
      ...atual,
      id: `dup_${Date.now()}`,
      nomeFormatacao: `${atual.nomeFormatacao || montarNomeAutomatico(atual)} (cópia)`,
    }));
    setMensagem('Rascunho duplicado.');
    setErro('');
  };

  const adicionarRota = () => {
    setForm((atual) => ({
      ...atual,
      rotas: [...atual.rotas, { id: `rota_${Date.now()}`, cotacao: '', ibgeDestino: '', prazo: '' }],
    }));
  };

  const adicionarQuebra = () => {
    setForm((atual) => ({
      ...atual,
      quebrasFaixa: [...atual.quebrasFaixa, { id: `qf_${Date.now()}`, cotacao: '', ibgeDestino: '', cepInicial: '', cepFinal: '', prazo: '' }],
    }));
  };

  const atualizarRota = (id, campo, valor) => {
    setForm((atual) => ({ ...atual, rotas: atual.rotas.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)) }));
  };

  const atualizarQuebra = (id, campo, valor) => {
    setForm((atual) => ({ ...atual, quebrasFaixa: atual.quebrasFaixa.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)) }));
  };

  const atualizarFrete = (id, campo, valor) => {
    setForm((atual) => ({ ...atual, fretes: atual.fretes.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)) }));
  };

  const excluirLinha = (grupo, id) => {
    setForm((atual) => ({ ...atual, [grupo]: atual[grupo].filter((item) => item.id !== id) }));
  };

  const importarArquivo = async (evento, tipo) => {
    const file = evento.target.files?.[0];
    if (!file) return;
    try {
      setErro('');
      if (tipo === 'ibge') {
        const base = await importarBaseIbge(file);
        setBaseIbge(base);
        setMensagem(`Base IBGE importada: ${base.resumo.totalMunicipios} municípios e ${base.resumo.totalFaixas} faixas.`);
      }
      if (tipo === 'rotas') {
        const rotas = await importarRotas(file);
        setForm((atual) => ({ ...atual, rotas }));
        setMensagem(`Rotas importadas: ${rotas.length} linha(s).`);
      }
      if (tipo === 'quebras') {
        const itens = await importarQuebras(file);
        setForm((atual) => ({ ...atual, quebrasFaixa: itens }));
        setMensagem(`Quebras importadas: ${itens.length} linha(s).`);
      }
      if (tipo === 'fretes') {
        const itens = await importarFretes(file);
        setForm((atual) => ({ ...atual, fretes: itens }));
        setMensagem(`Fretes importados: ${itens.length} linha(s).`);
      }
    } catch (e) {
      setErro(`Erro ao importar arquivo: ${e.message || e}`);
      setMensagem('');
    } finally {
      evento.target.value = '';
    }
  };

  const gerarFretes = () => {
    const fretes = gerarFretesAutomaticos(form);
    setForm((atual) => ({ ...atual, fretes }));
    setMensagem(`Fretes automáticos gerados: ${fretes.length} linha(s).`);
    setErro('');
  };

  return (
    <div className="page-shell">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">Cadastros avançados</div>
          <h1>Formatação de Tabelas</h1>
          <p>
            Módulo isolado para montar tabelas de rotas e fretes sem alterar o que já funciona no simulador.
            O vínculo com a base principal só fica para uma etapa futura de publicação.
          </p>
        </div>
        <div className="amd-quick-actions">
          <button className="btn-secondary" onClick={novoRascunho}>Novo rascunho</button>
          <button className="btn-secondary" onClick={duplicarRascunho}>Duplicar</button>
          <button className="btn-primary" onClick={salvarRascunhoAtual}>Salvar rascunho</button>
        </div>
      </div>

      {mensagem ? <div className="fmt-alert success">{mensagem}</div> : null}
      {erro ? <div className="fmt-alert error">{erro}</div> : null}

      <div className="fmt-layout">
        <aside className="fmt-sidebar-card">
          <h3>Etapas</h3>
          <div className="fmt-steps">
            {ETAPAS.map((etapa, index) => (
              <button
                key={etapa}
                type="button"
                className={etapaAtual === index ? 'fmt-step active' : 'fmt-step'}
                onClick={() => setEtapaAtual(index)}
              >
                <span className="fmt-step-number">{index + 1}</span>
                <span>{etapa}</span>
              </button>
            ))}
          </div>

          <div className="fmt-sidebar-section">
            <h4>Base IBGE</h4>
            <p>Importe a base mestre para preencher o IBGE de origem automaticamente e preparar o uso de CEP por município.</p>
            <button className="btn-secondary full" onClick={() => inputIbgeRef.current?.click()}>Importar base IBGE</button>
            <input ref={inputIbgeRef} type="file" accept=".xlsx,.xls,.xlsb" hidden onChange={(e) => importarArquivo(e, 'ibge')} />
            {baseIbge?.resumo ? (
              <div className="fmt-kpi-box">
                <strong>{baseIbge.resumo.totalMunicipios}</strong>
                <span>municípios</span>
                <strong>{baseIbge.resumo.totalFaixas}</strong>
                <span>faixas de CEP</span>
              </div>
            ) : null}
          </div>

          <div className="fmt-sidebar-section">
            <h4>Rascunhos</h4>
            <div className="fmt-drafts">
              {rascunhos.length ? rascunhos.map((item) => (
                <button key={item.id} className="fmt-draft-item" type="button" onClick={() => carregarRascunho(item.id)}>
                  <strong>{item.nomeFormatacao || montarNomeAutomatico(item) || 'Sem nome'}</strong>
                  <span>{item.transportadora || 'Sem transportadora'}</span>
                </button>
              )) : <div className="fmt-empty">Nenhum rascunho salvo ainda.</div>}
            </div>
          </div>
        </aside>

        <section className="fmt-main-card">
          {etapaAtual === 0 && (
            <div className="fmt-section">
              <h2>Dados gerais</h2>
              <div className="fmt-grid two-cols">
                <Campo label="Nome da formatação" value={form.nomeFormatacao} onChange={(v) => atualizarCampo('nomeFormatacao', v)} />

                <ModoCadastroCard
                  titulo="Transportadora"
                  modo={form.transportadoraModo}
                  onChangeModo={(valor) => atualizarCampo('transportadoraModo', valor)}
                >
                  {form.transportadoraModo === 'existente' ? (
                    <CampoSelect
                      label="Selecionar transportadora"
                      value={form.transportadoraExistente}
                      onChange={(v) => atualizarCampo('transportadoraExistente', v)}
                      options={cadastroBase.transportadoras}
                      placeholder="Selecione..."
                    />
                  ) : (
                    <Campo label="Nova transportadora" value={form.transportadora} onChange={(v) => atualizarCampo('transportadora', v)} />
                  )}
                  {transportadoraDuplicada ? <AvisoCadastro texto="Essa transportadora já existe. Use a lista para evitar duplicidade." /> : null}
                </ModoCadastroCard>

                <ModoCadastroCard
                  titulo="Origem"
                  modo={form.origemModo}
                  onChangeModo={(valor) => atualizarCampo('origemModo', valor)}
                >
                  {form.origemModo === 'existente' ? (
                    <CampoSelect
                      label="Selecionar origem"
                      value={form.origemExistenteKey}
                      onChange={(v) => atualizarCampo('origemExistenteKey', v)}
                      options={opcoesOrigem.map((item) => ({ value: item.key, label: `${item.nome} · ${item.canal} · ${item.codigo}` }))}
                      placeholder="Selecione..."
                    />
                  ) : (
                    <Campo label="Nova origem" value={form.origemNome} onChange={(v) => atualizarCampo('origemNome', v)} />
                  )}
                  {origemDuplicada ? <AvisoCadastro texto="Essa origem já existe para esse canal. Reaproveite a origem cadastrada para manter o mesmo código." /> : null}
                </ModoCadastroCard>

                <Campo label="Código da unidade / origem" value={form.codigoUnidade} onChange={() => {}} readOnly helper="Gerado automaticamente conforme os cadastros existentes." />
                <CampoSelect label="Canal" value={form.canal} onChange={(v) => atualizarCampo('canal', v)} options={CANAIS} disabled={form.origemModo === 'existente'} />
                <CampoSelect label="Método de envio" value={form.metodoEnvio} onChange={(v) => atualizarCampo('metodoEnvio', v)} options={METODOS_ENVIO} />
                <CampoSelect label="Regra de cálculo" value={form.regraCalculo} onChange={(v) => atualizarCampo('regraCalculo', v)} options={REGRAS_CALCULO} />
                <CampoSelect label="Tipo de cálculo" value={form.tipoCalculo} onChange={(v) => atualizarCampo('tipoCalculo', v)} options={TIPOS_CALCULO} />
                <Campo label="IBGE origem (automático)" value={form.origemIbge} onChange={() => {}} readOnly />
                <Campo label="Vigência inicial" type="date" value={form.vigenciaInicial} onChange={(v) => atualizarCampo('vigenciaInicial', v)} />
                <Campo label="Vigência final" type="date" value={form.vigenciaFinal} onChange={(v) => atualizarCampo('vigenciaFinal', v)} />
              </div>
              <div className="fmt-inline-note">
                <strong>Como funciona:</strong> transportadora e origem podem vir do cadastro já existente. Quando for uma origem nova, o sistema gera o próximo código disponível automaticamente.
              </div>
              <label className="fmt-field full">
                <span>Observações</span>
                <textarea value={form.observacoes} onChange={(e) => atualizarCampo('observacoes', e.target.value)} rows={4} />
              </label>
            </div>
          )}

          {etapaAtual === 1 && (
            <div className="fmt-section">
              <div className="fmt-section-header">
                <div>
                  <h2>Rotas</h2>
                  <p>Cadastro simples: apenas IBGE destino, prazo e cotação. O IBGE de origem é preenchido automaticamente pela origem dos dados gerais.</p>
                </div>
                <div className="fmt-actions-inline">
                  <button className="btn-secondary" onClick={() => exportarModeloRotas()}>Exportar modelo</button>
                  <button className="btn-secondary" onClick={() => inputRotasRef.current?.click()}>Importar rotas</button>
                  <button className="btn-primary" onClick={adicionarRota}>Adicionar rota</button>
                  <input ref={inputRotasRef} type="file" accept=".xlsx,.xls,.xlsb" hidden onChange={(e) => importarArquivo(e, 'rotas')} />
                </div>
              </div>
              <TabelaRotas itens={form.rotas} onChange={atualizarRota} onDelete={(id) => excluirLinha('rotas', id)} />
            </div>
          )}

          {etapaAtual === 2 && (
            <div className="fmt-section">
              <div className="fmt-section-header">
                <div>
                  <h2>Quebra de Faixas</h2>
                  <p>Use esta etapa apenas quando os CEPs precisarem sobrescrever a cobertura padrão da base IBGE.</p>
                </div>
                <div className="fmt-actions-inline">
                  <button className="btn-secondary" onClick={() => exportarModeloQuebras()}>Exportar modelo</button>
                  <button className="btn-secondary" onClick={() => inputQuebrasRef.current?.click()}>Importar quebra</button>
                  <button className="btn-primary" onClick={adicionarQuebra}>Adicionar quebra</button>
                  <input ref={inputQuebrasRef} type="file" accept=".xlsx,.xls,.xlsb" hidden onChange={(e) => importarArquivo(e, 'quebras')} />
                </div>
              </div>
              <TabelaQuebras itens={form.quebrasFaixa} onChange={atualizarQuebra} onDelete={(id) => excluirLinha('quebrasFaixa', id)} />
            </div>
          )}

          {etapaAtual === 3 && (
            <div className="fmt-section">
              <div className="fmt-section-header">
                <div>
                  <h2>Fretes</h2>
                  <p>Gere automaticamente pela estrutura das rotas ou importe o preenchimento no modelo padrão.</p>
                </div>
                <div className="fmt-actions-inline">
                  <button className="btn-secondary" onClick={() => exportarModeloFretes(form)}>Exportar modelo</button>
                  <button className="btn-secondary" onClick={() => inputFretesRef.current?.click()}>Importar fretes</button>
                  <button className="btn-primary" onClick={gerarFretes}>Gerar linhas automáticas</button>
                  <input ref={inputFretesRef} type="file" accept=".xlsx,.xls,.xlsb" hidden onChange={(e) => importarArquivo(e, 'fretes')} />
                </div>
              </div>
              <TabelaFretes itens={form.fretes} onChange={atualizarFrete} onDelete={(id) => excluirLinha('fretes', id)} />
            </div>
          )}

          {etapaAtual === 4 && (
            <div className="fmt-section">
              <div className="fmt-section-header">
                <div>
                  <h2>Revisão</h2>
                  <p>Confira os principais pontos antes de exportar o pacote final.</p>
                </div>
                <div className="fmt-actions-inline">
                  <button className="btn-secondary" onClick={salvarRascunhoAtual}>Salvar rascunho</button>
                  <button className="btn-primary" onClick={() => exportarPacoteCompleto(form)}>Exportar pacote completo</button>
                </div>
              </div>

              <div className="fmt-review-grid">
                <ResumoCard label="Transportadora" value={form.transportadora || '-'} />
                <ResumoCard label="Origem" value={`${form.origemNome || '-'} ${form.origemIbge ? `(${form.origemIbge})` : ''}`} />
                <ResumoCard label="Código" value={form.codigoUnidade || '-'} />
                <ResumoCard label="Rotas" value={String(form.rotas.length)} />
                <ResumoCard label="Quebras" value={String(form.quebrasFaixa.length)} />
                <ResumoCard label="Fretes" value={String(form.fretes.length)} />
              </div>

              <div className="fmt-validation-panels">
                <div className="fmt-validation-panel">
                  <h4>Erros</h4>
                  {validacao.erros.length ? <ul>{validacao.erros.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum erro encontrado.</p>}
                </div>
                <div className="fmt-validation-panel">
                  <h4>Alertas</h4>
                  {validacao.alertas.length ? <ul>{validacao.alertas.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum alerta encontrado.</p>}
                </div>
              </div>
            </div>
          )}

          <div className="fmt-footer-actions">
            <button className="btn-secondary" disabled={etapaAtual === 0} onClick={() => setEtapaAtual((atual) => Math.max(0, atual - 1))}>Voltar</button>
            <button className="btn-primary" disabled={etapaAtual === ETAPAS.length - 1} onClick={() => setEtapaAtual((atual) => Math.min(ETAPAS.length - 1, atual + 1))}>Avançar</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Campo({ label, value, onChange, readOnly = false, type = 'text', helper = '' }) {
  return (
    <label className="fmt-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} />
      {helper ? <small>{helper}</small> : null}
    </label>
  );
}

function CampoSelect({ label, value, onChange, options, placeholder = '', disabled = false }) {
  const itens = options.map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  return (
    <label className="fmt-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {itens.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  );
}

function ModoCadastroCard({ titulo, modo, onChangeModo, children }) {
  return (
    <div className="fmt-mode-card">
      <div className="fmt-mode-card-head">
        <span>{titulo}</span>
        <div className="fmt-choice-row">
          {MODOS_CADASTRO.map((item) => (
            <button
              key={item.value}
              type="button"
              className={modo === item.value ? 'fmt-choice active' : 'fmt-choice'}
              onClick={() => onChangeModo(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function AvisoCadastro({ texto }) {
  return <div className="fmt-inline-warning">{texto}</div>;
}

function TabelaRotas({ itens, onChange, onDelete }) {
  return (
    <div className="fmt-table-wrap">
      <table className="fmt-table">
        <thead>
          <tr>
            <th>Cotação</th>
            <th>IBGE destino</th>
            <th>Prazo</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {itens.length ? itens.map((item) => (
            <tr key={item.id}>
              <td><input value={item.cotacao} onChange={(e) => onChange(item.id, 'cotacao', e.target.value)} /></td>
              <td><input value={item.ibgeDestino} onChange={(e) => onChange(item.id, 'ibgeDestino', e.target.value)} /></td>
              <td><input value={item.prazo} onChange={(e) => onChange(item.id, 'prazo', e.target.value)} /></td>
              <td><button className="inline-btn" onClick={() => onDelete(item.id)}>Excluir</button></td>
            </tr>
          )) : <tr><td colSpan="4" className="fmt-empty-row">Nenhuma rota cadastrada.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TabelaQuebras({ itens, onChange, onDelete }) {
  return (
    <div className="fmt-table-wrap">
      <table className="fmt-table">
        <thead>
          <tr>
            <th>Cotação</th>
            <th>IBGE destino</th>
            <th>CEP inicial</th>
            <th>CEP final</th>
            <th>Prazo</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {itens.length ? itens.map((item) => (
            <tr key={item.id}>
              <td><input value={item.cotacao} onChange={(e) => onChange(item.id, 'cotacao', e.target.value)} /></td>
              <td><input value={item.ibgeDestino} onChange={(e) => onChange(item.id, 'ibgeDestino', e.target.value)} /></td>
              <td><input value={item.cepInicial} onChange={(e) => onChange(item.id, 'cepInicial', e.target.value)} /></td>
              <td><input value={item.cepFinal} onChange={(e) => onChange(item.id, 'cepFinal', e.target.value)} /></td>
              <td><input value={item.prazo} onChange={(e) => onChange(item.id, 'prazo', e.target.value)} /></td>
              <td><button className="inline-btn" onClick={() => onDelete(item.id)}>Excluir</button></td>
            </tr>
          )) : <tr><td colSpan="6" className="fmt-empty-row">Nenhuma quebra cadastrada.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TabelaFretes({ itens, onChange, onDelete }) {
  return (
    <div className="fmt-table-wrap">
      <table className="fmt-table">
        <thead>
          <tr>
            <th>Rota do frete</th>
            <th>Faixa</th>
            <th>Peso mínimo</th>
            <th>Peso limite</th>
            <th>Excesso</th>
            <th>Taxa aplicada</th>
            <th>Frete %</th>
            <th>Frete mínimo</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {itens.length ? itens.map((item) => (
            <tr key={item.id}>
              <td><input value={item.rotaFrete} onChange={(e) => onChange(item.id, 'rotaFrete', e.target.value)} /></td>
              <td><input value={item.faixaNome} onChange={(e) => onChange(item.id, 'faixaNome', e.target.value)} /></td>
              <td><input value={item.pesoMinimo} onChange={(e) => onChange(item.id, 'pesoMinimo', e.target.value)} /></td>
              <td><input value={item.pesoLimite} onChange={(e) => onChange(item.id, 'pesoLimite', e.target.value)} /></td>
              <td><input value={item.excessoPeso} onChange={(e) => onChange(item.id, 'excessoPeso', e.target.value)} /></td>
              <td><input value={item.taxaAplicada} onChange={(e) => onChange(item.id, 'taxaAplicada', e.target.value)} /></td>
              <td><input value={item.fretePercentual} onChange={(e) => onChange(item.id, 'fretePercentual', e.target.value)} /></td>
              <td><input value={item.freteMinimo} onChange={(e) => onChange(item.id, 'freteMinimo', e.target.value)} /></td>
              <td><button className="inline-btn" onClick={() => onDelete(item.id)}>Excluir</button></td>
            </tr>
          )) : <tr><td colSpan="9" className="fmt-empty-row">Nenhum frete cadastrado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ResumoCard({ label, value }) {
  return (
    <div className="fmt-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
