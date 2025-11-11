import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const gatewayTarget = process.env.VITE_DEV_GATEWAY_TARGET || 'http://localhost:18080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/root/graphql': {
        target: gatewayTarget,
        changeOrigin: true,
        secure: false
      }
    }
  }
});


