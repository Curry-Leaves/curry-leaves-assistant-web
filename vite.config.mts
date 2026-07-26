import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Expose our own CL_-prefixed env vars to client code (e.g. CL_BACKEND_URL,
  // read in src/frontend/api/http.ts). Vite only exposes VITE_* by default.
  envPrefix: ['VITE_', 'CL_'],
  // react-draggable (used by react-grid-layout for tile drag/resize) reads
  // process.env.NODE_ENV directly; Vite doesn't polyfill Node globals in the
  // browser bundle, so without this every drag/resize throws "process is not
  // defined" the instant a handle is grabbed.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});
