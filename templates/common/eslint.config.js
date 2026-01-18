import globals from 'globals';

const NODE_BUILTIN_MODULES = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'https',
  'module', 'net', 'os', 'path', 'perf_hooks', 'punycode',
  'querystring', 'readline', 'stream', 'string_decoder', 'timers',
  'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib'
];

const TITANPL_GLOBALS = {
  t: 'readonly',
  Titan: 'readonly'
};

export default [
  {
    ignores: ['**/*.d.ts']
  },
  {
    files: ['app/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...TITANPL_GLOBALS
      }
    },
    rules: {
      'no-undef': 'error',
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*'], message: 'No disponible en TitanPL' },
          { group: NODE_BUILTIN_MODULES, message: 'No disponible en TitanPL' }
        ]
      }]
    }
  }
];