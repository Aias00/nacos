/*
 * Copyright 1999-2026 Alibaba Group Holding Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const consolePath = env.NACOS_CONSOLE_CONTEXT || '/control';
  const authPath = env.NACOS_AUTH_CONTEXT || '/nacos';
  return {
    base: './',
    plugins: [react()],
    resolve: {
      alias: [{
        // Keep Monaco's embedded sanitizer on the same patched dependency as Next UI.
        find: './dompurify/dompurify.js',
        replacement: fileURLToPath(new URL('./node_modules/dompurify/dist/purify.es.mjs', import.meta.url)),
      }],
    },
    server: {
      proxy: {
        '/platform-api/v3/auth': {
          target: env.NACOS_AUTH_TARGET || 'http://127.0.0.1:8848',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/platform-api/, authPath),
        },
        '/platform-api/v3/console': {
          target: env.NACOS_CONSOLE_TARGET || 'http://127.0.0.1:18090',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/platform-api/, consolePath),
        },
      },
    },
    build: { target: 'es2022' },
  };
});
