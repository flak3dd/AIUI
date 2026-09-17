import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const sparkHost = env.VITE_SPARK_HOST || '192.168.4.103'
  const sparkPort = env.VITE_SPARK_PORT || '8000'
  const sparkTarget = `http://${sparkHost}:${sparkPort}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Browser calls /gx10-vllm/v1/* or /spark-vllm/v1/* → GX10 vLLM (Qwen Flash)
        '/gx10-vllm': {
          target: sparkTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gx10-vllm/, ''),
        },
        '/spark-vllm': {
          target: sparkTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/spark-vllm/, ''),
        },
        '/mempalace-bridge': {
          target: 'http://127.0.0.1:17333',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/mempalace-bridge/, ''),
        },
      },
    },
  }
})
