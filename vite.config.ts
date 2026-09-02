import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "AMD LOG | Central de Fretes",
        short_name: "Central de Fretes",
        description: "Plataforma de gestão de fretes AMD LOG",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0f172a",
        orientation: "portrait",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App autenticado com dados em tempo real: não cachear chamadas de API/Supabase,
        // só os assets estáticos do próprio build.
        // O sistema depende de conexão para consultar os dados. Deixar o
        // service worker responder navegações com index.html em cache pode
        // misturar HTML antigo com assets de um deploy novo e gerar tela
        // branca. Assets estáticos continuam no precache, mas toda navegação
        // busca o HTML atual na hospedagem.
        navigateFallbackDenylist: [/./],
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
});
