const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'ReajustesPage.jsx');

if (!fs.existsSync(filePath)) {
  console.error('Arquivo não encontrado:', filePath);
  process.exit(1);
}

const original = fs.readFileSync(filePath, 'utf8');

const start = original.indexOf('function VinculoRealizadoCell(');
const end = original.indexOf('\nexport default function ReajustesPage', start);

if (start < 0 || end < 0) {
  console.error('Não encontrei o bloco VinculoRealizadoCell para substituir.');
  process.exit(1);
}

const novoBloco = `function VinculoRealizadoCell({ item, opcoesRealizado, busca, onBusca, onToggle, onMarcar, onLimpar }) {
  const [aberto, setAberto] = useState(false);
  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const sugestoes = useMemo(() => detectarMelhoresVinculos(item.transportadoraInformada, opcoesRealizado.map((opcao) => opcao.nome), 8), [item.transportadoraInformada, opcoesRealizado]);
  const opcoes = useMemo(() => filtrarOpcoesRealizado(opcoesRealizado, busca, item.transportadoraInformada), [opcoesRealizado, busca, item.transportadoraInformada]);
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));

  const resumoSelecionadas = selecionadas.length
    ? selecionadas.join(' | ')
    : 'Sem vínculo realizado';

  const totalCtesSelecionados = selecionadas.reduce((acc, nome) => {
    const nomeNorm = normalizarTextoReajuste(nome);
    const encontrada = opcoesRealizado.find((opcao) => normalizarTextoReajuste(opcao.nome) === nomeNorm);
    return acc + toNumber(encontrada?.ctes);
  }, 0);

  const totalFreteSelecionado = selecionadas.reduce((acc, nome) => {
    const nomeNorm = normalizarTextoReajuste(nome);
    const encontrada = opcoesRealizado.find((opcao) => normalizarTextoReajuste(opcao.nome) === nomeNorm);
    return acc + toNumber(encontrada?.frete);
  }, 0);

  return (
    <div style={{ minWidth: 360, display: 'grid', gap: 8 }}>
      <div style={{
        border: '1px solid #d8e2f2',
        borderRadius: 14,
        padding: 10,
        background: selecionadas.length ? '#f8fbff' : '#fff',
        display: 'grid',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: 1.35,
            }}>
              {resumoSelecionadas}
            </div>
            <small style={{ display: 'block', color: '#64748b', marginTop: 4 }}>
              {selecionadas.length
                ? \`\${selecionadas.length} vínculo(s) • \${totalCtesSelecionados.toLocaleString('pt-BR')} CT-e(s) • \${Number(totalFreteSelecionado || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\`
                : 'Clique em editar para vincular pelos nomes do Realizado Local.'}
            </small>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {selecionadas.length ? (
              <button type="button" className="btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onLimpar}>
                Limpar
              </button>
            ) : null}
            <button type="button" className="btn-primary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setAberto((prev) => !prev)}>
              {aberto ? 'Recolher' : 'Editar'}
            </button>
          </div>
        </div>

        {aberto ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
            <input
              value={busca || ''}
              onChange={(event) => onBusca(event.target.value)}
              placeholder="Buscar nome no Realizado Local..."
            />

            {sugestoes.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: '#64748b', fontSize: 12 }}>Sugestões:</span>
                {sugestoes.map((nome) => (
                  <button key={nome} type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onToggle(nome, true)}>
                    + {nome}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" style={{ padding: '5px 8px', fontSize: 12 }} onClick={() => onMarcar(opcoes.map((opcao) => opcao.nome))} disabled={!opcoes.length}>
                Marcar filtrados
              </button>
              <button type="button" className="btn-secondary" style={{ padding: '5px 8px', fontSize: 12 }} onClick={onLimpar} disabled={!selecionadas.length}>
                Limpar seleção
              </button>
              <button type="button" className="btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setAberto(false)}>
                Concluir vínculo
              </button>
            </div>

            <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #d8e2f2', borderRadius: 12, padding: 8, background: '#fff' }}>
              {opcoes.map((opcao) => {
                const checked = selecionadasNorm.has(normalizarTextoReajuste(opcao.nome));
                return (
                  <label key={opcao.nome} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 8, alignItems: 'start', padding: '4px 0' }}>
                    <input type="checkbox" checked={checked} onChange={(event) => onToggle(opcao.nome, event.target.checked)} />
                    <span>
                      <strong>{opcao.nome}</strong>
                      <small style={{ display: 'block', color: '#64748b' }}>
                        {opcao.ctes.toLocaleString('pt-BR')} CT-e(s) • {Number(opcao.frete || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </small>
                    </span>
                  </label>
                );
              })}
              {!opcoes.length && <div style={{ color: '#64748b' }}>Nenhum nome encontrado na base realizada local.</div>}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

`;

const updated = original.slice(0, start) + novoBloco + original.slice(end + 1);

fs.writeFileSync(filePath, updated, 'utf8');

console.log('OK: vínculo do Realizado Local agora fica recolhido e abre apenas ao clicar em Editar.');
