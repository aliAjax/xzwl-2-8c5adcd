#!/usr/bin/env node

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const command = args[0];
const composeFile = 'docker-compose.test.yml';
const service = 'postgres-test';

const hasCommand = (cmd) => {
  const result = spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
  return result.status === 0;
};

const resolveCompose = () => {
  if (hasCommand('docker')) {
    const result = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    if (result.status === 0) {
      return ['docker', ['compose']];
    }
  }

  if (hasCommand('docker-compose')) {
    return ['docker-compose', []];
  }

  console.error(
    'Docker Compose is required for the integration test database. Install Docker Desktop or docker-compose, then rerun npm run test:db:up.'
  );
  process.exit(127);
};

const run = (cmd, cmdArgs, options = {}) => {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const runCompose = (compose, composeArgs) => {
  const [cmd, baseArgs] = compose;
  run(cmd, [...baseArgs, '-f', composeFile, ...composeArgs]);
};

const waitForDatabase = (compose) => {
  const [cmd, baseArgs] = compose;
  const deadline = Date.now() + 30000;

  process.stdout.write('Waiting for database');
  while (Date.now() < deadline) {
    const result = spawnSync(
      cmd,
      [
        ...baseArgs,
        '-f',
        composeFile,
        'exec',
        '-T',
        service,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        'xzwl_test',
      ],
      { stdio: 'ignore' }
    );

    if (result.status === 0) {
      process.stdout.write('\nDatabase ready!\n');
      return;
    }

    process.stdout.write('.');
    spawnSync('sleep', ['1']);
  }

  process.stdout.write('\n');
  console.error('Timed out waiting for the test database to become ready.');
  process.exit(1);
};

const createShadowDatabase = (compose) => {
  const [cmd, baseArgs] = compose;
  const result = spawnSync(
    cmd,
    [
      ...baseArgs,
      '-f',
      composeFile,
      'exec',
      '-T',
      service,
      'sh',
      '-c',
      'createdb -U postgres xzwl_shadow 2>/dev/null || true',
    ],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const compose = resolveCompose();

if (command === 'up') {
  runCompose(compose, ['up', '-d']);
  waitForDatabase(compose);
  createShadowDatabase(compose);
} else if (command === 'shadow') {
  createShadowDatabase(compose);
} else if (command === 'down') {
  runCompose(compose, ['down', '-v']);
} else {
  console.error('Usage: node scripts/test-db.js <up|shadow|down>');
  process.exit(1);
}
