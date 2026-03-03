import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'

const OFFLINE_ASSET_MANIFEST = 'asset-manifest.json'
const __dirname = dirname(fileURLToPath(import.meta.url))

const buildOfflineAssetManifestPlugin = () => ({
  name: 'build-offline-asset-manifest',
  apply: 'build',
  generateBundle(_, bundle) {
    const assets = new Set()

    Object.entries(bundle).forEach(([fileName, output]) => {
      if (output.type === 'chunk') {
        if (fileName.startsWith('assets/')) {
          assets.add(`/${fileName}`)
        }

        const importedCss = output.viteMetadata?.importedCss
        if (importedCss && importedCss.size) {
          importedCss.forEach((cssFile) => {
            if (cssFile) assets.add(`/${cssFile}`)
          })
        }
        return
      }

      if (output.type === 'asset' && fileName.startsWith('assets/')) {
        assets.add(`/${fileName}`)
      }
    })

    const payload = {
      generated_at: new Date().toISOString(),
      assets: Array.from(assets).sort(),
    }

    this.emitFile({
      type: 'asset',
      fileName: OFFLINE_ASSET_MANIFEST,
      source: JSON.stringify(payload, null, 2),
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const upiId = String(env.UPI_ID || '').trim()

  const devUpiConfigApi = {
    name: 'dev-upi-config-api',
    configureServer(server) {
      server.middlewares.use('/api/config', (req, res) => {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ message: 'Method not allowed' }))
          return
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!upiId) {
          res.statusCode = 500
          res.end(JSON.stringify({ message: 'UPI_ID is not configured on the server.' }))
          return
        }

        res.statusCode = 200
        res.end(JSON.stringify({ upiId }))
      })
    }
  }

  return {
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      open: false
    },
    plugins: [
      react(),
      buildOfflineAssetManifestPlugin(),
      ...(command === 'serve' ? [devUpiConfigApi] : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
});
