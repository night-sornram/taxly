import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "taxly-offline-shell",
      apply: "build",
      enforce: "post",
      generateBundle(_options, bundle) {
        const files = [
          "/",
          "/index.html",
          "/manifest.webmanifest",
          "/app-icon.svg",
          "/apple-touch-icon.png",
          ...Object.keys(bundle)
            .filter((name) => name !== "index.html")
            .map((name) => `/${name}`),
        ];
        const hash = createHash("sha256").update(JSON.stringify(files));
        for (const asset of Object.values(bundle))
          hash.update(asset.type === "chunk" ? asset.code : asset.source);
        for (const name of ["manifest.webmanifest", "app-icon.svg", "apple-touch-icon.png"])
          hash.update(readFileSync(new URL(`./public/${name}`, import.meta.url)));
        const version = hash.digest("hex").slice(0, 16);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE='taxly-shell-${version}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('taxly-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;
if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html',{ignoreVary:true}))));return;}
if(FILES.includes(u.pathname))e.respondWith(caches.open(CACHE).then(c=>c.match(u.pathname,{ignoreVary:true})).then(c=>c||fetch(r)));});`,
        });
      },
    },
  ],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
