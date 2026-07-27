import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const watch = process.argv.includes("--watch");

function copyManifest() {
  mkdirSync("dist", { recursive: true });
  copyFileSync("manifest.json", "dist/manifest.json");
  copyFileSync("src/popup/popup.html", "dist/popup.html");
  copyFileSync("src/popup/popup.css", "dist/popup.css");
  copyFileSync("public/icon48.png", "dist/icon48.png");
}

const ctx = await esbuild.context({
  entryPoints: {
    background: "src/background/service-worker.ts",
    "content-page-bridge": "src/content/page-bridge.ts",
    "content-linkedin": "src/content/linkedin.ts",
    popup: "src/popup/popup.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
});

copyManifest();

if (watch) {
  await ctx.watch();
  console.log("Watching…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
