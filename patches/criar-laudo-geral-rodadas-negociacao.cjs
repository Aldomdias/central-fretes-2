const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');
let src = fs.readFileSync(file, 'utf8');
let changed = false;
function rep(a,b,msg){
  if(src.includes(a)){src=src.replace(a,b);changed=true;console.log('OK '+msg);return;}
  if(src.includes(b)){console.log('SKIP '+msg);return;}
  console.warn('WARN '+msg);
}
rep("import { LaudoNegociacaoTemplate } from '../components/laudos';", "import { LaudoNegociacaoTemplate, LaudoRodadasNegociacaoTemplate } from '../components/laudos';", 'import laudo rodadas');
rep("  const [laudoSalvoAberto, setLaudoSalvoAberto] = useState(null);", "  const [laudoSalvoAberto, setLaudoSalvoAberto] = useState(null);\n  const [tipoLaudoRodadas, setTipoLaudoRodadas] = useState('transportador');", 'estado laudo rodadas');
const bloco = `
                <div className="sim-card" style={{ marginBottom: 14 }}>
                  <div className="sim-parametros-header" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Laudo geral das rodadas</h3>
                      <p style={{ margin: '6px 0 0', color: '#64748b' }}>
                        Analisa a evolucao da negociacao por rodada e mostra onde a transportadora melhorou, onde ainda perde e quais rotas, cotacoes, UFs e faixas precisam de ajuste.
                      </p>
                    </div>
                    <div className="sim-actions" style={{ margin: 0 }}>
                      <button className={tipoLaudoRodadas === 'transportador' ? 'primary' : 'sim-tab'} type="button" onClick={function() { setTipoLaudoRodadas('transportador'); }}>Transportador</button>
                      <button className={tipoLaudoRodadas === 'executivo' ? 'primary' : 'sim-tab'} type="button" onClick={function() { setTipoLaudoRodadas('executivo'); }}>Diretoria</button>
                    </div>
                  </div>
                  {simulacoes.length < 2 ? (
                    <div className="sim-alert info" style={{ marginTop: 12 }}>
                      Para uma analise completa de evolucao, o ideal e ter pelo menos duas simulacoes salvas. Com uma unica simulacao, o laudo mostra o diagnostico atual sem comparacao entre rodadas.
                    </div>
                  ) : null}
                  <div style={{ marginTop: 14 }}>
                    <LaudoRodadasNegociacaoTemplate tipo={tipoLaudoRodadas} tabela={selecionada} />
                  </div>
                </div>
`;
if(!src.includes('Laudo geral das rodadas') && src.includes('                <div className="sim-analise-tabela-wrap">')){
  src = src.replace('                <div className="sim-analise-tabela-wrap">', bloco + '\n                <div className="sim-analise-tabela-wrap">');
  changed = true;
  console.log('OK bloco laudo rodadas');
}else if(src.includes('Laudo geral das rodadas')) console.log('SKIP bloco laudo rodadas');
else console.warn('WARN ponto bloco laudo rodadas');
if(changed){fs.writeFileSync(file, src, 'utf8');console.log('Prompt 4.16 aplicado.');}
else console.log('Prompt 4.16 sem alteracoes.');
