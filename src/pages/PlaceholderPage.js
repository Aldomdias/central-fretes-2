export default function PlaceholderPage({ titulo, descricao }) {
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>{titulo}</h2>
          <p>{descricao}</p>
        </div>
      </div>

      <div className="bloco-info">
        <h3>Próxima etapa</h3>
        <p>
          Esta tela ficará pronta nas próximas versões. Nesta entrega estamos
          estruturando a base do projeto, o menu, os cadastros principais e a
          lógica da tabela com generalidades e taxas por destino.
        </p>
      </div>
    </div>
  );
}
