// Builds the browser half into lib/ in dsh's client module format: a CJS factory registered
// with `window.__ModuleLoader__.load({ id, chunk?, factory })`, where `id` is the package name.
// The entry (client.js) and the three.js viewer (client.viewer.js) are separate builds, so the
// viewer chunk is self-contained and the entry loads it with `require.async`.
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const ID = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name
// The package icon, inlined so the settings card shows the same Meshy mark as the Plugins card.
const ICON = `data:image/svg+xml;base64,${readFileSync(new URL('./icon.svg', import.meta.url)).toString('base64')}`
// The host's seed modules (React and dsh's own component library); everything else is bundled.
const SEED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives']

const build = (file: string, entry: string, chunk: boolean) => defineConfig({
  entry: { [file]: entry },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  minify: chunk,
  define: { __MESHY_ICON__: JSON.stringify(ICON) },
  deps: { neverBundle: (id: string) => SEED.includes(id), alwaysBundle: (id: string) => !SEED.includes(id) },
  outputOptions: {
    entryFileNames: `${file}.js`,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)},${chunk ? ` chunk: "${file}.js",` : ''} factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})

export default [
  build('client', 'src/client/index.tsx', false),
  build('client.viewer', 'src/client/viewer.ts', true),
]
