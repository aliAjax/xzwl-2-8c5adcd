#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const defaultDatabaseUrl = 'postgresql://postgres:postgres@localhost:5433/xzwl_test?schema=public';

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const deriveShadowDatabaseUrl = (databaseUrl) => {
  try {
    const url = new URL(databaseUrl);
    url.pathname = '/xzwl_shadow';
    return url.toString();
  } catch (_error) {
    return 'postgresql://postgres:postgres@localhost:5433/xzwl_shadow?schema=public';
  }
};

loadEnvFile(path.resolve(process.cwd(), '.env.test'));

const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL || deriveShadowDatabaseUrl(databaseUrl);
const prismaBin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';

const result = spawnSync(
  prismaBin,
  [
    'migrate',
    'diff',
    '--from-migrations',
    'prisma/migrations',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--exit-code',
    '--shadow-database-url',
    shadowDatabaseUrl,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SHADOW_DATABASE_URL: shadowDatabaseUrl,
    },
  }
);

process.exit(result.status || 0);
