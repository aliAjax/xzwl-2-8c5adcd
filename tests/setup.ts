import prisma from '../src/prisma/client';

beforeAll(async () => {
  console.log('Test setup: Connecting to database...');
});

afterAll(async () => {
  console.log('Test teardown: Disconnecting from database...');
  await prisma.$disconnect();
});
