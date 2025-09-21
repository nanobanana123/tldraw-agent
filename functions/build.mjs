import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

await build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: resolve(__dirname, 'dist/index.cjs'),
  sourcemap: true,
  external: ['firebase-functions', 'firebase-admin'],
})

console.log('Built Firebase function to dist/index.cjs')
