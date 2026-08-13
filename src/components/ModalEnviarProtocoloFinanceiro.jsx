import { useEffect, useMemo, useState } from 'react';
import {
  STATUS_FATURA_PROTOCOLO,
  TIPOS_ENVIO_PROTOCOLO,
  calcularDescontoAutomaticoFatura,
  validarProtocoloFinanceiro,
} from '../utils/auditoriaFretesDomain';
import {
  buscarDadosBancariosTransportadora,
  buscarProtocoloAtivoPorFatura,
  enviarFaturaParaProtocolo,
  listarCentrosCusto,
  salvarDadosBancariosTransportadora,
} from '../services/auditoriaFretesService';
import { inferirTipoChavePix } from '../utils/dadosBancariosImport';
import { cnpjPreenchidoValido, formatarCnpj } from '../utils/cnpj';

const DADOS_BANCARIOS_MANUAL_VAZIO = {
  favorecido: '', cnpj: '', banco: '', agencia: '', conta: '', tipo_conta: '', chave_pix: '', tipo_chave_pix: '',
};

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(data) {
  if (!data) return '-';
  return new Date(`${String(data).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
}

const NOME_TIPO_ENVIO = { DADOS_BANCARIOS: 'Dados Bancarios', BOLETO: 'Boleto' };
const NOME_STATUS_PROTOCOLO = {
  LANCAMENTO_MANUAL: 'Lancamento Manual',
  COBRANCA_PROCESSADA: 'Cobranca Processada',
  MISTA: 'Mista',
};

export default function ModalEnviarProtocoloFinanceiro({ state, fatura, detalhes, tolerancia, sessao, onClose, onState }) {
  const [carregando, setCarregando] = useState(true);
  const [contasBancarias, setContasBancarias] = useState([]);
  const [contaSelecionadaId, setContaSelecionadaId] = useState('');
  const [centrosCusto, setCentrosCusto] = useState([]);
  const [protocoloExistente, setProtocoloExistente] = useState(null);
  const [statusProtocolo, setStatusProtocolo] = useState('');
  const [tipoEnvio, setTipoEnvio] = useState('DADOS_BANCARIOS');
  const [partida, setPartida] = useState('');
  const [valorCobrancaProcessada, setValorCobrancaProcessada] = useState('');
  const [valorLancamentoManual, setValorLancamentoManual] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [descontoManual, setDescontoManual] = useState('0');
  const [descontoManualJustificativa, setDescontoManualJustificativa] = useState('');
  const [centroCustoCodigo, setCentroCustoCodigo] = useState('');
  const [centroCustoManualCodigo, setCentroCustoManualCodigo] = useState('');
  const [centroCustoManualDescricao, setCentroCustoManualDescricao] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [mostrarComposicao, setMostrarComposicao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [forcarSubstituicao, setForcarSubstituicao] = useState(false);
  const [dadosBancariosManual, setDadosBancariosManual] = useState({
    ...DADOS_BANCARIOS_MANUAL_VAZIO,
    favorecido: fatura.transportadora || '',
    cnpj: fatura.cnpj_transportadora || '',
  });
  const [salvarCadastroBancario, setSalvarCadastroBancario] = useState(true);

  useEffect(() => {
    const aoTeclar = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onClose]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    Promise.all([
      buscarDadosBancariosTransportadora(fatura.transportadora, fatura.cnpj_transportadora),
      listarCentrosCusto(),
      buscarProtocoloAtivoPorFatura(fatura.id),
    ]).then(([bancarios, centros, protocolo]) => {
      if (!ativo) return;
      setContasBancarias(bancarios.contas || []);
      setContaSelecionadaId(bancarios.principal?.id || '');
      setCentrosCusto(centros || []);
      setProtocoloExistente(protocolo || null);
    }).finally(() => {
      if (ativo) setCarregando(false);
    });
    return () => { ativo = false; };
  }, [fatura.id]);

  const descontoAutomatico = useMemo(
    () => calcularDescontoAutomaticoFatura(detalhes, tolerancia),
    [detalhes, tolerancia],
  );

  const valorFatura = Number(fatura.valor_fatura || 0);
  const descontoAutomaticoTotal = Number(fatura.auditoria_total_descontar ?? descontoAutomatico.total ?? 0);
  const descontoManualNum = Number(descontoManual || 0) || 0;
  const descontoTotal = Number((descontoAutomaticoTotal + descontoManualNum).toFixed(2));
  const valorRealAPagar = Number((valorFatura - descontoTotal).toFixed(2));
  const contaSelecionada = contasBancarias.find((item) => item.id === contaSelecionadaId) || null;
  const vencida = fatura.data_vencimento && new Date(`${fatura.data_vencimento}T12:00:00`) < new Date(new Date().toDateString());

  const semCadastroBancario = tipoEnvio === 'DADOS_BANCARIOS' && !contasBancarias.length;
  const manualPreenchidoOk = !!dadosBancariosManual.favorecido.trim()
    && cnpjPreenchidoValido(dadosBancariosManual.cnpj)
    && (!!dadosBancariosManual.chave_pix.trim() || (!!dadosBancariosManual.banco.trim() && !!dadosBancariosManual.agencia.trim() && !!dadosBancariosManual.conta.trim()));
  const dadosBancariosResolvidos = tipoEnvio !== 'DADOS_BANCARIOS'
    ? null
    : semCadastroBancario
      ? (manualPreenchidoOk ? { ...dadosBancariosManual, cnpj: formatarCnpj(dadosBancariosManual.cnpj), tipo_chave_pix: dadosBancariosManual.tipo_chave_pix || inferirTipoChavePix(dadosBancariosManual.chave_pix), cadastro_novo: true } : null)
      : contaSelecionada;

  const dadosProtocolo = {
    fatura_id: fatura.id,
    responsavel_id: sessao?.id || '',
    responsavel_nome: fatura.auditor_nome || sessao?.nome || sessao?.email || '',
    transportadora: fatura.transportadora,
    cnpj_transportadora: fatura.cnpj_transportadora,
    vencimento: fatura.data_vencimento,
    tipo_envio: tipoEnvio,
    dados_bancarios: dadosBancariosResolvidos,
    status_fatura_protocolo: statusProtocolo,
    valor_fatura_original: valorFatura,
    desconto_automatico: descontoAutomaticoTotal,
    desconto_manual: descontoManualNum,
    desconto_manual_justificativa: descontoManualJustificativa,
    desconto_total: descontoTotal,
    valor_real_a_pagar: valorRealAPagar,
    partida,
    valor_cobranca_processada: statusProtocolo === 'MISTA' ? Number(valorCobrancaProcessada || 0) : null,
    valor_lancamento_manual: statusProtocolo === 'MISTA' ? Number(valorLancamentoManual || 0) : null,
    centro_custo_codigo: centroCustoCodigo === 'OUTRO' ? centroCustoManualCodigo.trim() : centroCustoCodigo,
    centro_custo_descricao: centroCustoCodigo === 'OUTRO'
      ? centroCustoManualDescricao.trim()
      : centrosCusto.find((item) => item.codigo === centroCustoCodigo)?.descricao || '',
    anexos,
    observacoes,
    composicao_descontos: descontoAutomatico.composicao,
    substituirProtocoloId: forcarSubstituicao ? protocoloExistente?.id : null,
  };

  const pendencias = validarProtocoloFinanceiro(dadosProtocolo);
  const bloqueadoPorDuplicidade = !!protocoloExistente && !forcarSubstituicao;

  const adicionarAnexo = (event) => {
    const arquivos = Array.from(event.target.files || []);
    setAnexos((atual) => [...atual, ...arquivos.map((arquivo) => ({ nome: arquivo.name, tamanho: arquivo.size }))]);
    event.target.value = '';
  };

  const removerAnexo = (indice) => {
    setAnexos((atual) => atual.filter((_, i) => i !== indice));
  };

  const enviar = async () => {
    setErro('');
    if (pendencias.length || bloqueadoPorDuplicidade) return;
    setEnviando(true);
    try {
      let dadosParaEnvio = dadosProtocolo;
      if (semCadastroBancario && manualPreenchidoOk && salvarCadastroBancario) {
        const novoCadastro = await salvarDadosBancariosTransportadora({
          transportadora: fatura.transportadora,
          ...dadosBancariosResolvidos,
          principal: true,
          ativo: true,
          observacao: 'Cadastrado durante envio do Protocolo Financeiro (dados sem cadastro previo).',
        });
        dadosParaEnvio = { ...dadosProtocolo, dados_bancarios: novoCadastro };
      }
      const { state: proximoEstado } = await enviarFaturaParaProtocolo(state, fatura, dadosParaEnvio, {
        id: sessao?.id || '',
        nome: sessao?.nome || sessao?.email || 'Usuario local',
        email: sessao?.email || '',
      });
      onState(proximoEstado);
      onClose();
    } catch (error) {
      if (error.protocoloExistente) {
        setProtocoloExistente(error.protocoloExistente);
      }
      setErro(error.message || String(error));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card audit-detail" onClick={(event) => event.stopPropagation()}>
        <div className="section-row compact-top">
          <div className="panel-title">Enviar para Protocolo Financeiro</div>
          <button className="btn-secondary" onClick={onClose}>Fechar</button>
        </div>

        {carregando ? (
          <div className="hint-box compact">Carregando dados da fatura...</div>
        ) : (
          <>
            {protocoloExistente && (
              <div className="hint-box compact error-text">
                Esta fatura ja possui protocolo financeiro: <strong>{protocoloExistente.protocolo}</strong> (status {protocoloExistente.status},
                enviado em {protocoloExistente.enviado_em ? new Date(protocoloExistente.enviado_em).toLocaleString('pt-BR') : '-'} por {protocoloExistente.responsavel_nome || '-'}).
                <div style={{ marginTop: 6 }}>
                  <label>
                    <input type="checkbox" checked={forcarSubstituicao} onChange={(event) => setForcarSubstituicao(event.target.checked)} />
                    {' '}Gerar novo protocolo substituindo o anterior
                  </label>
                </div>
              </div>
            )}

            <h2>Fatura</h2>
            <div className="form-grid three">
              <label className="field">Fatura<input value={fatura.numero_fatura || ''} readOnly /></label>
              <label className="field">Transportadora<input value={fatura.transportadora || ''} readOnly /></label>
              <label className="field">CNPJ<input value={fatura.cnpj_transportadora || ''} readOnly /></label>
              <label className="field">Responsavel<input value={dadosProtocolo.responsavel_nome || 'Sem auditor definido'} readOnly /></label>
              <label className="field">Vencimento
                <input value={dataBr(fatura.data_vencimento)} readOnly style={vencida ? { color: '#dc2626', fontWeight: 600 } : undefined} />
              </label>
            </div>

            <h2>Financeiro</h2>
            <div className="form-grid three">
              <label className="field">Tipo de envio
                <select value={tipoEnvio} onChange={(event) => setTipoEnvio(event.target.value)}>
                  {TIPOS_ENVIO_PROTOCOLO.map((tipo) => <option key={tipo} value={tipo}>{NOME_TIPO_ENVIO[tipo] || tipo}</option>)}
                </select>
              </label>
              <label className="field">Status da fatura
                <select value={statusProtocolo} onChange={(event) => setStatusProtocolo(event.target.value)}>
                  <option value="">Selecione</option>
                  {STATUS_FATURA_PROTOCOLO.map((status) => <option key={status} value={status}>{NOME_STATUS_PROTOCOLO[status]}</option>)}
                </select>
              </label>
            </div>

            {(statusProtocolo === 'COBRANCA_PROCESSADA' || statusProtocolo === 'MISTA') && (
              <div className="form-grid three">
                <label className="field">Partida<input value={partida} onChange={(event) => setPartida(event.target.value)} placeholder="Numero da partida" /></label>
              </div>
            )}
            {statusProtocolo === 'MISTA' && (
              <div className="form-grid three">
                <label className="field">Valor cobranca processada<input type="number" step="0.01" value={valorCobrancaProcessada} onChange={(event) => setValorCobrancaProcessada(event.target.value)} /></label>
                <label className="field">Valor lancamento manual<input type="number" step="0.01" value={valorLancamentoManual} onChange={(event) => setValorLancamentoManual(event.target.value)} /></label>
              </div>
            )}
            {(statusProtocolo === 'LANCAMENTO_MANUAL' || statusProtocolo === 'MISTA') && (
              <div className="form-grid three">
                <label className="field">Anexos das partidas de lancamento
                  <input type="file" multiple onChange={adicionarAnexo} />
                </label>
                <div>
                  {anexos.map((anexo, indice) => (
                    <div key={`${anexo.nome}-${indice}`} className="compact">
                      {anexo.nome} <button className="btn-secondary audit-small-button" onClick={() => removerAnexo(indice)}>Remover</button>
                    </div>
                  ))}
                  {!anexos.length && <span className="compact">Nenhum anexo adicionado.</span>}
                </div>
              </div>
            )}

            <h2>Valores</h2>
            <div className="summary-strip">
              <div><span>Valor da fatura</span><strong>{dinheiro(valorFatura)}</strong></div>
              <div><span>Desconto automatico</span><strong>{dinheiro(descontoAutomaticoTotal)}</strong></div>
              <div><span>Ajuste manual</span><strong>{dinheiro(descontoManualNum)}</strong></div>
              <div><span>Desconto total</span><strong>{dinheiro(descontoTotal)}</strong></div>
              <div><span>Valor real a pagar</span><strong>{dinheiro(valorRealAPagar)}</strong></div>
            </div>
            <button className="btn-secondary audit-small-button" onClick={() => setMostrarComposicao((v) => !v)}>
              {mostrarComposicao ? 'Ocultar composicao dos descontos' : 'Ver composicao dos descontos'}
            </button>
            {mostrarComposicao && (
              <table>
                <thead><tr><th>CT-e</th><th>Valor original</th><th>Desconto</th><th>Motivo</th><th>Valor final</th></tr></thead>
                <tbody>
                  {descontoAutomatico.composicao.map((item) => (
                    <tr key={item.chave_cte || item.numero_cte}>
                      <td>{item.numero_cte || item.chave_cte}</td>
                      <td>{dinheiro(item.valor_original)}</td>
                      <td style={item.desconto ? { color: '#dc2626' } : undefined}>{dinheiro(item.desconto)}</td>
                      <td>{item.motivo || '-'}</td>
                      <td>{dinheiro(item.valor_final)}</td>
                    </tr>
                  ))}
                  {!descontoAutomatico.composicao.length && <tr><td colSpan="5">Nenhum CT-e carregado para esta fatura.</td></tr>}
                </tbody>
              </table>
            )}

            <div className="form-grid three">
              <label className="field">Ajustar desconto manualmente
                <input type="number" step="0.01" value={descontoManual} onChange={(event) => setDescontoManual(event.target.value)} />
              </label>
              {descontoManualNum > 0 && (
                <label className="field">Justificativa do ajuste manual
                  <input value={descontoManualJustificativa} onChange={(event) => setDescontoManualJustificativa(event.target.value)} />
                </label>
              )}
              {descontoTotal > 0 && (
                <label className="field">Centro de custo do desconto
                  <select value={centroCustoCodigo} onChange={(event) => setCentroCustoCodigo(event.target.value)}>
                    <option value="">Selecione</option>
                    {centrosCusto.map((item) => <option key={item.codigo} value={item.codigo}>{item.codigo} - {item.descricao}</option>)}
                    <option value="OUTRO">Outro (informar manualmente)</option>
                  </select>
                </label>
              )}
            </div>
            {descontoTotal > 0 && centroCustoCodigo === 'OUTRO' && (
              <div className="form-grid three">
                <label className="field">Codigo do centro de custo<input value={centroCustoManualCodigo} onChange={(event) => setCentroCustoManualCodigo(event.target.value)} /></label>
                <label className="field">Descricao do centro de custo<input value={centroCustoManualDescricao} onChange={(event) => setCentroCustoManualDescricao(event.target.value)} /></label>
              </div>
            )}

            {tipoEnvio === 'DADOS_BANCARIOS' && (
              <>
                <h2>Dados bancarios</h2>
                {contasBancarias.length ? (
                  <div className="form-grid three">
                    <label className="field">Conta
                      <select value={contaSelecionadaId} onChange={(event) => setContaSelecionadaId(event.target.value)}>
                        {contasBancarias.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.favorecido || fatura.transportadora} - {item.chave_pix ? `PIX ${item.chave_pix}` : `${item.banco || ''} ag ${item.agencia || ''} cc ${item.conta || ''}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="hint-box compact error-text">
                      Nenhum dado bancario cadastrado para esta transportadora. Preencha manualmente abaixo para prosseguir (ou selecione o tipo de envio Boleto).
                    </div>
                    <div className="form-grid three">
                      <label className="field">Favorecido<input value={dadosBancariosManual.favorecido} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, favorecido: event.target.value })} /></label>
                      <label className="field">CNPJ<input value={dadosBancariosManual.cnpj} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, cnpj: event.target.value })} /></label>
                      <label className="field">Banco<input value={dadosBancariosManual.banco} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, banco: event.target.value })} /></label>
                      <label className="field">Agencia<input value={dadosBancariosManual.agencia} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, agencia: event.target.value })} /></label>
                      <label className="field">Conta<input value={dadosBancariosManual.conta} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, conta: event.target.value })} /></label>
                      <label className="field">Chave PIX<input value={dadosBancariosManual.chave_pix} onChange={(event) => setDadosBancariosManual({ ...dadosBancariosManual, chave_pix: event.target.value })} /></label>
                    </div>
                    <label>
                      <input type="checkbox" checked={salvarCadastroBancario} onChange={(event) => setSalvarCadastroBancario(event.target.checked)} />
                      {' '}Salvar estes dados no cadastro da transportadora para as proximas faturas
                    </label>
                  </>
                )}
              </>
            )}

            <h2>Observacoes</h2>
            <textarea rows={3} value={observacoes} onChange={(event) => setObservacoes(event.target.value)} placeholder="Informacoes complementares (nao repita partida, desconto, centro de custo, etc.)" />

            {(pendencias.length > 0 || bloqueadoPorDuplicidade) && (
              <div className="hint-box compact error-text">
                <strong>Pendencias antes do envio:</strong>
                <ul>
                  {bloqueadoPorDuplicidade && <li>Fatura ja possui protocolo ativo — marque a opcao de substituicao para reenviar.</li>}
                  {pendencias.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {erro && <div className="hint-box compact error-text">{erro}</div>}

            <div className="audit-action-bar">
              <button className="btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" disabled={enviando || pendencias.length > 0 || bloqueadoPorDuplicidade} onClick={enviar}>
                {enviando ? 'Enviando...' : 'Enviar para Protocolo Financeiro'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
