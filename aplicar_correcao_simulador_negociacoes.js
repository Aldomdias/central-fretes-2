const fs = require('fs');
const path = require('path');

const arquivo = path.join(process.cwd(), 'src', 'pages', 'SimuladorPage.jsx');

if (!fs.existsSync(arquivo)) {
  console.error('ERRO: não encontrei src/pages/SimuladorPage.jsx.');
  process.exit(1);
}

let conteudo = fs.readFileSync(arquivo, 'utf8');

const antigo = `  // Ao abrir o simulador, carrega TODAS as negociações disponíveis pra simular
  // (sem filtro de canal) para que apareçam como concorrentes "(negociação)" em
  // todas as abas (simples, por transportadora, análise). Silencioso; o Realizado
  // continua re-hidratando por canal quando precisa.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const completas = await buscarTabelasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO' });
        if (!ativo || !completas?.length) return;
        completas.forEach((tabela) => negociacoesHidratadasRef.current.add(tabela.id));
        capasNegociacaoCarregadasRef.current = true;
        setNegociacoesSimulador((prev) => (prev && prev.length ? prev : completas));
        setNegociacoesAtualizadasEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch { /* silencioso — não bloqueia o simulador */ }
    })();
    return () => { ativo = false; };
  }, []);`;

const novo = `  // Carrega as negociações completas ao abrir o simulador para que possam
  // concorrer em TODAS as abas.
  useEffect(() => {
    let ativo = true;

    const carregarNegociacoesCompletas = async () => {
      setCarregandoNegociacoesSimulador(true);
      setErroNegociacoesSimulador('');
      setEtapaNegociacoesSimulador('detalhe');

      try {
        const completas = await buscarTabelasNegociacaoParaSimulacao({
          tipoTabela: 'FRACIONADO',
        });

        if (!ativo) return;

        const tabelasCompletas = completas || [];
        tabelasCompletas.forEach((tabela) => negociacoesHidratadasRef.current.add(tabela.id));
        capasNegociacaoCarregadasRef.current = true;
        setNegociacoesSimulador(tabelasCompletas);
        setNegociacoesAtualizadasEm(
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        );
        setEtapaNegociacoesSimulador('concluido');
      } catch (error) {
        if (!ativo) return;
        setErroNegociacoesSimulador(
          error?.message || 'Erro ao carregar negociações disponíveis para a simulação.',
        );
        setEtapaNegociacoesSimulador('erro');
      } finally {
        if (ativo) setCarregandoNegociacoesSimulador(false);
      }
    };

    carregarNegociacoesCompletas();
    return () => { ativo = false; };
  }, []);`;

if (!conteudo.includes(antigo)) {
  console.error('ERRO: bloco não localizado. Nenhuma alteração foi feita.');
  process.exit(2);
}

const backup = `${arquivo}.backup-negociacoes-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(arquivo, backup);
fs.writeFileSync(arquivo, conteudo.replace(antigo, novo), 'utf8');

console.log('OK: correção aplicada.');
console.log(`Backup criado: ${path.basename(backup)}`);
