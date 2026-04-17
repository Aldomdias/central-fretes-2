import { useMemo, useState } from 'react';
import {
  baixarModelo,
  buildCoberturaReport,
  buildImportPayload,
  exportarSecao,
  parseFileToRows,
} from '../utils/importacao';

const TIPOS = [
  { id: 'rotas', label: 'Rotas' },
  { id: 'cotacoes', label: 'Fretes/Cotações' },
  { id: 'taxas', label: 'Taxas Especiais' },
  { id: 'generalidades', label: 'Generalidades' },
];

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function CoberturaBadge({ value }) {
  const cls = value === 'Completa' ? 'coverage-badge ok' : 'coverage-badge warn';
  return <span className={cls}>{value}</span>;
}

export default function ImportacaoPage({ store, transportadoras, onAbrirTransportadoras }) {
  const [tipo, setTipo] = useState('rotas');
  const [processando, setProcessando] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [detalhe, setDetalhe] = useState(null);
  const [canalImportacao, setCanalImportacao] = useState('ATACADO');

  const cobertura = useMemo(
    () => buildCoberturaReport(transportadoras),
    [transportadoras]
  );

  const pendencias = useMemo(
    () =>
      cobertura.detalhes.filter(
        (item) =>
          !filtro ||
          item.transportadora.toLowerCase().includes(filtro.toLowerCase()) ||
          item.origem.toLowerCase().includes(filtro.toLowerCase())
      ),
    [cobertura, filtro]
  );

  const exportarMassa = () => {
    const rows = [];

    transportadoras.forEach((transportadora) => {
      (transportadora.origens || []).forEach((origem) => {
        const base = {
          transportadora: transportadora.nome,
          origem: origem.cidade,
          canal: origem.canal || 'ATACADO',
          codigoUnidade:
            origem.canal === 'B2C' ? '0001 - B2C' : '0001 - B2B',
        };

        if (tipo === 'rotas') {
          rows.push(...(origem.rotas || []).map((item) => ({ ...base, ...item })));
        }

        if (tipo === 'cotacoes') {
          rows.push(...(origem.cotacoes || []).map((item) => ({ ...base, ...item })));
        }

        if (tipo === 'taxas') {
          rows.push(
            ...(origem.taxasEspeciais || []).map((item) => ({ ...base, ...item }))
          );
        }

        if (tipo === 'generalidades' && origem.generalidades) {
          rows.push({ ...base, ...origem.generalidades });
        }
      });
    });

    exportarSecao(tipo, rows, `exportacao-${tipo}.xlsx`);
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setProcessando(true);
    const novasEntradas = [];

    for (const file of files) {
      try {
        const parsed = await parseFileToRows(file, tipo);
        const payload = buildImportPayload(parsed, tipo, {
          canal: canalImportacao,
        });

        store.importarPayload(payload, tipo);

        const registro = {
          arquivo: file.name,
          tipo,
          canal: canalImportacao,
          inseridos: payload.inseridos,
          erros: payload.erros,
          meta: parsed.meta || {},
        };

        try {
          await registrarImportacao({
            arquivo: registro.arquivo,
            tipo: registro.tipo,
            canal: registro.canal,
            inseridos: registro.inseridos,
            erros: registro.erros,
            meta: registro.meta,
          });
        } catch (dbError) {
          registro.erros = [
            ...(registro.erros || []),
            {
              linha: '-',
              coluna: 'supabase',
              valor: '',
              mensagem: dbError.message || 'Falha ao registrar importação no banco.',
            },
          ];
        }

        novasEntradas.push(registro);
      } catch (error) {
        novasEntradas.push({
          arquivo: file.name,
          tipo,
          canal: canalImportacao,
          inseridos: 0,
          erros: [
            {
              linha: '-',
              coluna: 'arquivo',
              valor: '',
              mensagem: error.message || 'Erro ao ler arquivo.',
            },
          ],
        });
      }
    }

    setHistorico((prev) => [...novasEntradas, ...prev].slice(0, 15));
    setDetalhe(novasEntradas[0] || null);
    setProcessando(false);
    event.target.value = '';
  };

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <h1>Importação e Cobertura</h1>
          <p>
            Importe em massa por tipo, baixe o modelo correto e veja onde ainda
            falta informação.
          </p>
        </div>

        <button className="btn-secondary" onClick={onAbrirTransportadoras}>
          Abrir cadastros
        </button>
      </div>

      <div className="summary-strip">
        <SummaryCard
          title="Origens monitoradas"
          value={cobertura.totais.origens}
          subtitle="origens com alguma configuração"
        />
        <SummaryCard
          title="Cobertura completa"
          value={cobertura.totais.completas}
          subtitle="com rotas, cotações e generalidades"
        />
        <SummaryCard
          title="Pendências"
          value={cobertura.totais.pendentes}
          subtitle="origens que ainda precisam de carga"
        />
        <SummaryCard
          title="Destinos mapeados"
          value={cobertura.totais.destinos}
          subtitle="soma dos destinos identificados"
        />
      </div>

      <div className="feature-grid import-grid">
        <div className="panel-card">
          <div className="panel-title">⬆️ Importação em massa</div>

          <div className="toggle-row wrap">
            {TIPOS.map((item) => (
              <button
                key={item.id}
                className={tipo === item.id ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => setTipo(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p>
            Use os modelos para não errar o layout. O importador já tenta ler o
            cabeçalho real mesmo quando ele começa algumas linhas abaixo.
          </p>

          <div className="channel-picker">
            <div className="field small-width">
              <label>Canal da importação</label>
              <select
                value={canalImportacao}
                onChange={(e) => setCanalImportacao(e.target.value)}
              >
                <option value="ATACADO">ATACADO</option>
                <option value="B2C">B2C</option>
              </select>
            </div>

            <div className="hint-box compact">
              O canal escolhido será usado quando a planilha não trouxer a
              coluna <strong>Canal</strong> ou quando o código da unidade não
              indicar B2C.
            </div>
          </div>

          <div className="toolbar-wrap">
            <button className="btn-secondary" onClick={() => baixarModelo(tipo)}>
              Baixar Modelo
            </button>

            <button className="btn-secondary" onClick={exportarMassa}>
              Exportar Atual
            </button>

            <label className="btn-primary inline-upload">
              {processando ? 'Processando...' : 'Importar arquivos'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                onChange={handleFiles}
                hidden
              />
            </label>
          </div>

          <div className="hint-box top-space">
            <strong>Observações:</strong>
            <br />
            • Rotas e fretes foram adequados ao padrão dos seus arquivos reais.
            <br />
            • Dentro de cada origem também existe <strong>Exportar</strong>,{' '}
            <strong>Baixar Modelo</strong>, <strong>Importar</strong> e{' '}
            <strong>Excluir Tudo</strong>.
            <br />
            • Em taxas especiais, <strong>GRIS</strong> e{' '}
            <strong>Ad Valorem</strong> por IBGE têm prioridade sobre as
            generalidades.
          </div>
        </div>

        <div className="panel-card">
          <div className="panel-title">🧠 Últimos processamentos</div>

          <div className="list-stack compact-list">
            {historico.length ? (
              historico.map((item, index) => (
                <div
                  className="list-card neutral process-card"
                  key={`${item.arquivo}-${index}`}
                  onClick={() => setDetalhe(item)}
                >
                  <div>
                    <div className="list-title small">{item.arquivo}</div>
                    <div className="list-subtitle">
                      Tipo: {item.tipo} · Canal: {item.canal || '-'} · Inseridos:{' '}
                      {item.inseridos}
                    </div>
                    {!!item.erros.length && (
                      <div className="error-text">
                        {item.erros.length} erro(s) encontrado(s)
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-note">
                Nenhum arquivo importado nesta sessão.
              </div>
            )}
          </div>
        </div>
      </div>

      {detalhe && (
        <div className="panel-card">
          <div className="tab-panel-header spaced">
            <div>
              <div className="panel-title no-margin">Detalhe do processamento</div>
              <p>
                {detalhe.arquivo} · Canal: {detalhe.canal || '-'} · Inseridos:{' '}
                {detalhe.inseridos} · Cabeçalho encontrado na linha{' '}
                {detalhe.meta?.headerIndex || '-'}
              </p>
            </div>
          </div>

          {detalhe.erros?.length ? (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Coluna</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhe.erros.slice(0, 50).map((erro, idx) => (
                    <tr key={idx}>
                      <td>{erro.linha}</td>
                      <td>{erro.coluna || 'layout'}</td>
                      <td>{erro.mensagem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mini-feedback ok">Arquivo processado sem erros.</div>
          )}
        </div>
      )}

      <div className="panel-card">
        <div className="tab-panel-header spaced">
          <div>
            <div className="panel-title no-margin">
              📍 Cobertura por transportadora e origem
            </div>
            <p>
              Use este painel para enxergar rápido o que ainda está sem frete
              importado.
            </p>
          </div>

          <input
            className="search-input small-width"
            placeholder="Filtrar por transportadora ou origem"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Origem</th>
                <th>Canal</th>
                <th>Cobertura</th>
                <th>Rotas</th>
                <th>Cotações</th>
                <th>Taxas</th>
                <th>Destinos</th>
              </tr>
            </thead>
            <tbody>
              {pendencias.length ? (
                pendencias.map((item, idx) => (
                  <tr key={`${item.transportadora}-${item.origem}-${idx}`}>
                    <td>{item.transportadora}</td>
                    <td>{item.origem}</td>
                    <td>{item.canal}</td>
                    <td>
                      <CoberturaBadge value={item.cobertura} />
                    </td>
                    <td>{item.totalRotas}</td>
                    <td>{item.totalCotacoes}</td>
                    <td>{item.totalTaxas}</td>
                    <td>{item.destinos}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="empty-cell">
                    Nenhum resultado encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
