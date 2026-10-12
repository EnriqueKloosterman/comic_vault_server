// Shim: ESLint 9 defaults to flat config, but this repo uses legacy
// .eslintrc.js (user decision, phase 1). Forces legacy mode
// cross-platform (Windows cmd + Linux sh) without extra deps.
// TODO(phase-08): migrate to eslint.config.js and drop this shim.
process.env.ESLINT_USE_FLAT_CONFIG = 'false';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const eslintBin = path.join(__dirname, '..', 'node_modules', 'eslint', 'bin', 'eslint.js');
const result = spawnSync(process.execPath, [eslintBin, 'src/**/*.ts', 'test/**/*.ts'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
