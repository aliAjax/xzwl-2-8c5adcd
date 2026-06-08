import prisma from '../src/prisma/client';

beforeAll(async () => {
  console.log('Test setup: Connecting to database...');
  try {
    await prisma.$connect();
    console.log('Test setup: Database connected successfully');
  } catch (error) {
    console.error('Test setup: Failed to connect to database', error);
    throw error;
  }
});

afterEach(async () => {
  if (process.env.NODE_ENV === 'test') {
    await prisma.$executeRaw`SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = current_database()
      AND pid <> pg_backend_pid()`;
  }
});

afterAll(async () => {
  console.log('Test teardown: Disconnecting from database...');
  try {
    await prisma.$disconnect();
    console.log('Test teardown: Database disconnected successfully');
  } catch (error) {
    console.error('Test teardown: Error disconnecting from database', error);
  }
});
