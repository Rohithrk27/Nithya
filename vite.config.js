import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'

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
      open: true
    },
    logLevel: 'error',
    plugins: [
      react(),
      ...(command === 'serve' ? [devUpiConfigApi] : []),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
});
