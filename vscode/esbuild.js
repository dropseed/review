const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Extension build config (Node.js environment)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: !production,
  minify: production,
  target: "node18",
};

async function build() {
  try {
    if (watch) {
      const ctx = await esbuild.context(extensionConfig);
      await ctx.watch();
      console.log("[watch] Build started...");
    } else {
      await esbuild.build(extensionConfig);
      console.log("[build] Build complete.");
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

build();
