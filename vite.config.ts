import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

// Custom plugin to handle ?import&react syntax (alias to ?react)
const svgImportPlugin = () => ({
  name: 'svg-import-alias',
  resolveId(id) {
    // Transform ?import&react to ?react for vite-plugin-svgr
    if (id.includes('?import&react')) {
      return id.replace('?import&react', '?react');
    }
    return null;
  },
});

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('gpt-tokenizer')) return 'tok';
          if (id.includes('lucide-react')) return 'ui';
          if (id.includes('react-dom') || id.includes('scheduler')) return 'dom';
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    svgImportPlugin(),
    svgr({
      // Support named ReactComponent export (for ?react syntax)
      svgrOptions: {
        exportType: 'named',
        namedExport: 'ReactComponent',
        ref: true,
        svgo: false,
        titleProp: true,
      },
      include: '**/*.svg?react',
    }),
  ],
  server: {
    allowedHosts: true,
    hmr: false,
    proxy: {
      '/api/llm-proxy': {
        target: 'https://sbqyohmjugwqlzpepeyu.supabase.co/functions/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  },
}))
