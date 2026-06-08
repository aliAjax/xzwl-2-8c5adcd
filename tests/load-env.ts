import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envTestPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envTestPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envTestPath));
  for (const k in envConfig) {
    if (!(k in process.env)) {
      process.env[k] = envConfig[k];
    }
  }
  console.log(`Loaded test environment from .env.test`);
} else {
  console.log('Warning: .env.test file not found, using default environment variables');
}

if (process.env.DATABASE_URL) {
  const maskedUrl = process.env.DATABASE_URL.replace(/:.*@/, ':***@');
  console.log(`Test database: ${maskedUrl}`);
} else {
  console.log('Warning: DATABASE_URL environment variable not set');
}

