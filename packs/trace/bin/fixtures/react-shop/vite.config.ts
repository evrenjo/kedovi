import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// 가짜 백엔드: 개발 서버가 /api 를 직접 답한다 (예제라서. 실제 프로젝트는 프록시 · MSW)
const products = [
  { id: 10, name: 'pen', price: 1200, stock: 5 },
  { id: 11, name: 'note', price: 3000, stock: 0 },
  { id: 12, name: 'bag', price: 25000, stock: 2 },
]
function fakeApi(): Plugin {
  return {
    name: 'fake-api',
    configureServer(server) {
      server.middlewares.use('/api/products', (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(products))
      })
      server.middlewares.use('/api/orders', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const order = JSON.parse(body || '{}')
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ orderId: 7, paid: order.total, status: 'PLACED' }))
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), fakeApi()],
  server: { port: 5199 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
