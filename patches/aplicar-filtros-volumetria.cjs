const fs = require('fs');
const path = 'src/pages/FerramentasPage.jsx';

if (!fs.existsSync(path)) {
  console.error(`Arquivo não encontrado: ${path}`);
  process.exit(1);
}

let content = fs.readFileSync(path, 'utf8');

const novoDefaultConfig = `const DEFAULT_CONFIG = {
  canal: '',
  inicio: '',
  fim: '',
  origem: '',
  ufOrigem: '',
  ufDestino: '',
  agrupamento: 'cidade_ibge',
  excluirEbazar: true,
  incluirDetalhe: true,
  vincularCtes: true,
};`;

content = content.replace(/const DEFAULT_CONFIG = \{[\s\S]*?\};/, novoDefaultConfig);

if (!content.includes('const UF_OPTIONS =')) {
  content = content.replace(
    "const CANAIS_GRADE = ['ATACADO', 'B2C'];",
    "const CANAIS_GRADE = ['ATACADO', 'B2C'];\nconst UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];"
  );
}

const filtroAntigo = `canal: config.canal,
        inicio: config.inicio,
        fim: config.fim,
        excluirEbazar:`;
const filtroNovo = `canal: config.canal,
        inicio: config.inicio,
        fim: config.fim,
        origem: config.origem,
        ufOrigem: config.ufOrigem,
        ufDestino: config.ufDestino,
        excluirEbazar:`;
content = content.split(filtroAntigo).join(filtroNovo);

if (!content.includes('placeholder="Ex.: Itajaí, Sinop, Serra"')) {
  const marker = `        </div>

        <div className="form-grid three">
          <label className="field">Agrupamento`;
  const replacement = `        </div>

        <div className="form-grid three">
          <label className="field">Origem
            <input
              value={config.origem}
              onChange={(e) => alterar('origem', e.target.value)}
              placeholder="Ex.: Itajaí, Sinop, Serra"
            />
          </label>
          <label className="field">UF origem
            <select value={config.ufOrigem} onChange={(e) => alterar('ufOrigem', e.target.value)}>
              {UF_OPTIONS.map((uf) => <option key={uf || 'todos-origem'} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>
          <label className="field">UF destino
            <select value={config.ufDestino} onChange={(e) => alterar('ufDestino', e.target.value)}>
              {UF_OPTIONS.map((uf) => <option key={uf || 'todos-destino'} value={uf}>{uf || 'Todas'}</option>)}
            </select>
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">Agrupamento`;

  if (!content.includes(marker)) {
    console.error('Não encontrei o ponto correto para inserir os filtros de origem/UF. Verifique se o arquivo FerramentasPage.jsx está na versão esperada.');
    process.exit(1);
  }
  content = content.replace(marker, replacement);
}

content = content.replace(
  'Gera uma base agrupada da base local de Tracking com origem, destino, IBGE, faixa de peso, cubagem, valor de nota e volumes para precificação do transportador.',
  'Gera uma base agrupada da base local de Tracking com origem, destino, IBGE, faixa de peso, cubagem, valor de nota e volumes para precificação do transportador. Use os filtros de origem e UF para gerar uma base mais leve por necessidade do transportador.'
);

fs.writeFileSync(path, content, 'utf8');
console.log('OK - filtros de origem, UF origem e UF destino incluídos na exportação de volumetria.');
