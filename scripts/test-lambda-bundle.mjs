// Corre las e2e de la Lambda contra dist-lambda/lambda.js, el paquete que se
// sube a AWS. Script de Node y no `VAR=x jest` en package.json para que
// funcione igual en PowerShell.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    './node_modules/jest/bin/jest.js',
    '--config',
    './test/jest-e2e.json',
    '--runInBand',
    'lambda',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, LAMBDA_BUNDLE: 'dist-lambda/lambda.js' },
  },
);
process.exit(result.status ?? 1);
