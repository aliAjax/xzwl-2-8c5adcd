import { Prisma, PrismaClient, Difficulty, ProficiencyLevel } from '@prisma/client';
import prisma from '../src/prisma/client';

export interface TestDataIds {
  storeId: number;
  scriptId: number;
  hostId: number;
  roomId: number;
  sessionId: number;
  customerId: number;
  membershipAccountId?: number;
}

let testCounter = 0;

export const generateTestId = (): string => {
  testCounter++;
  return `test_${Date.now()}_${testCounter}`;
};

export const generatePhone = (): string => {
  const random = Math.floor(10000000 + Math.random() * 90000000);
  return `13${random}`;
};

export const createTestStore = async (tx: Prisma.TransactionClient | PrismaClient = prisma) => {
  const testId = generateTestId();
  return tx.store.create({
    data: {
      name: `Test Store ${testId}`,
      address: 'Test Address',
      phone: generatePhone(),
      businessStartTime: '10:00',
      businessEndTime: '23:00',
    },
  });
};

export const createTestScript = async (
  storeId: number,
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  const testId = generateTestId();
  return tx.script.create({
    data: {
      storeId,
      name: `Test Script ${testId}`,
      description: 'Test Description',
      minPlayers: 2,
      maxPlayers: 6,
      durationMin: 120,
      difficulty: Difficulty.MEDIUM,
    },
  });
};

export const createTestHost = async (
  storeId: number,
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  const testId = generateTestId();
  const host = await tx.host.create({
    data: {
      name: `Test Host ${testId}`,
      phone: generatePhone(),
      maxDailySessions: 5,
    },
  });

  await tx.hostStore.create({
    data: {
      hostId: host.id,
      storeId,
    },
  });

  return host;
};

export const createTestRoom = async (
  storeId: number,
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  const testId = generateTestId();
  return tx.room.create({
    data: {
      storeId,
      name: `Test Room ${testId}`,
      capacity: 10,
    },
  });
};

export const createTestSession = async (
  data: {
    storeId: number;
    scriptId: number;
    hostId: number;
    roomId: number;
    maxPlayers?: number;
    currentPlayers?: number;
    startTime?: Date;
    endTime?: Date;
    price?: Prisma.Decimal;
  },
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  const now = new Date();
  const startTime = data.startTime || new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endTime = data.endTime || new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

  return tx.session.create({
    data: {
      storeId: data.storeId,
      scriptId: data.scriptId,
      hostId: data.hostId,
      roomId: data.roomId,
      startTime,
      endTime,
      price: data.price || new Prisma.Decimal('100.00'),
      maxPlayers: data.maxPlayers || 6,
      currentPlayers: data.currentPlayers || 0,
    },
  });
};

export const createTestCustomer = async (
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  const testId = generateTestId();
  return tx.customer.create({
    data: {
      name: `Test Customer ${testId}`,
      phone: generatePhone(),
    },
  });
};

export const createTestMembershipAccount = async (
  customerId: number,
  initialBalance: Prisma.Decimal = new Prisma.Decimal('0'),
  tx: Prisma.TransactionClient | PrismaClient = prisma
) => {
  return tx.membershipAccount.create({
    data: {
      customerId,
      balance: initialBalance,
      isActive: true,
    },
  });
};

export const createFullTestEnvironment = async (
  config: {
    maxPlayers?: number;
    currentPlayers?: number;
    membershipBalance?: Prisma.Decimal;
  } = {}
): Promise<TestDataIds> => {
  return prisma.$transaction(async (tx) => {
    const store = await createTestStore(tx);
    const script = await createTestScript(store.id, tx);
    const host = await createTestHost(store.id, tx);
    const room = await createTestRoom(store.id, tx);
    const session = await createTestSession(
      {
        storeId: store.id,
        scriptId: script.id,
        hostId: host.id,
        roomId: room.id,
        maxPlayers: config.maxPlayers,
        currentPlayers: config.currentPlayers,
      },
      tx
    );
    const customer = await createTestCustomer(tx);

    let membershipAccountId: number | undefined;
    if (config.membershipBalance !== undefined) {
      const membershipAccount = await createTestMembershipAccount(
        customer.id,
        config.membershipBalance,
        tx
      );
      membershipAccountId = membershipAccount.id;
    }

    return {
      storeId: store.id,
      scriptId: script.id,
      hostId: host.id,
      roomId: room.id,
      sessionId: session.id,
      customerId: customer.id,
      membershipAccountId,
    };
  });
};

export const cleanupTestData = async (ids: TestDataIds) => {
  await prisma.$transaction(async (tx) => {
    await tx.notificationTask.deleteMany({
      where: {
        OR: [
          { relatedBookingId: { not: null } },
          { relatedSessionId: ids.sessionId },
          { relatedCustomerId: ids.customerId },
          { relatedTransactionId: { not: null } },
        ],
      },
    });

    await tx.membershipTransaction.deleteMany({
      where: { account: { customerId: ids.customerId } },
    });

    await tx.booking.deleteMany({
      where: { sessionId: ids.sessionId },
    });

    await tx.waitlist.deleteMany({
      where: { sessionId: ids.sessionId },
    });

    await tx.membershipAccount.deleteMany({
      where: { customerId: ids.customerId },
    });

    await tx.customer.deleteMany({
      where: { id: ids.customerId },
    });

    await tx.session.deleteMany({
      where: { id: ids.sessionId },
    });

    await tx.room.deleteMany({
      where: { id: ids.roomId },
    });

    await tx.hostStore.deleteMany({
      where: { hostId: ids.hostId, storeId: ids.storeId },
    });

    await tx.host.deleteMany({
      where: { id: ids.hostId },
    });

    await tx.script.deleteMany({
      where: { id: ids.scriptId },
    });

    await tx.store.deleteMany({
      where: { id: ids.storeId },
    });
  });
};

export const cleanupNotificationTasks = async (idempotencyKeys: string[]) => {
  await prisma.notificationTask.deleteMany({
    where: {
      idempotencyKey: { in: idempotencyKeys },
    },
  });
};

export const getCurrentPlayers = async (sessionId: number): Promise<number> => {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { currentPlayers: true },
  });
  return session?.currentPlayers ?? -1;
};

export const countBookings = async (sessionId: number): Promise<number> => {
  return prisma.booking.count({
    where: { sessionId, status: { not: 'CANCELLED' } },
  });
};

export const countWaitlists = async (
  sessionId: number,
  status?: string
): Promise<number> => {
  const where: any = { sessionId };
  if (status) where.status = status;
  return prisma.waitlist.count({ where });
};

export const countNotifications = async (
  idempotencyKeys: string[]
): Promise<number> => {
  return prisma.notificationTask.count({
    where: { idempotencyKey: { in: idempotencyKeys } },
  });
};

export const countTransactions = async (accountId: number): Promise<number> => {
  return prisma.membershipTransaction.count({
    where: { accountId },
  });
};
