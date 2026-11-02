import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { contentSecurityPolicy } from "./src/shared/csp";

function productionCsp(): Plugin {
  return {
    name: "production-csp",
    apply: "build",
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy("")}" />`;
      return html.replace("</head>", `    ${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), productionCsp()],
  // Markdown dependencies must select their DOM-free worker exports in dev and builds.
  resolve: { conditions: ["worker", ...defaultClientConditions] },
  server: {
    host: "127.0.0.1",
  },
});
