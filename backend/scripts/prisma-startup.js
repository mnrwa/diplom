const { spawnSync } = require('node:child_process');

const acceptDataLoss =
  process.env.PRISMA_ACCEPT_DATA_LOSS === 'true' ||
  process.env.PRISMA_ACCEPT_DATA_LOSS === '1';

const args = ['prisma', 'db', 'push'];

if (acceptDataLoss) {
  args.push('--accept-data-loss');
}

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
