import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Depois de uma nova versao no ar, uma aba antiga pede arquivos (chunks) que nao existem mais e a
// importacao dinamica falha ("Failed to fetch dynamically imported module"). O Vite avisa por este
// evento: recarrega a pagina UMA vez (por sessao) para pegar a versao nova.
window.addEventListener("vite:preloadError", (evento) => {
  try {
    if (sessionStorage.getItem("cf_recarregou_preload")) return;
    sessionStorage.setItem("cf_recarregou_preload", "1");
    evento.preventDefault();
    window.location.reload();
  } catch {
    /* sem sessionStorage: deixa o erro aparecer */
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);