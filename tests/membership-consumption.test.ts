import {
  Prisma,
  MembershipTransactionType,
  MembershipTransactionStatus,
  NotificationType,
  BookingStatus,
} from '@prisma/client';
import prisma from '../src/prisma/client';
import {
  createFullTestEnvironment,
  cleanupTestData,
  TestDataIds,
  countTransactions,
  countNotifications,
  cleanupNotificationTasks,
  createTestCustomer,
} from './helpers';
import {
  consume,
  consumeWithBooking,
  recharge,
  refund,
} from '../src/modules/membership/membership.service';
import {
  createBookingWithSessionUpdate,
} from '../src/modules/booking/booking.service';
import { generateIdempotencyKey } from '../src/modules/notification/notification.service';

describe('Membership Consumption and Transaction Records', () => {
  let testData: TestDataIds;
  let idempotencyKeys: string[] = [];

  beforeEach(async () => {
    testData = await createFullTestEnvironment({
      maxPlayers: 6,
      currentPlayers: 0,
      membershipBalance: new Prisma.Decimal('500.00'),
    });
    idempotencyKeys = [];
  });

  afterEach(async () => {
    await cleanupNotificationTasks(idempotencyKeys);
    await cleanupTestData(testData);
  });

  describe('Successful consumption', () => {
    it('should create transaction record and notification when consumption is successful', async () => {
      const initialAccount = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(initialAccount?.balance.toString()).toBe('500.00');

      let transactionId: number;
      const consumeAmount = new Prisma.Decimal('100.00');

      const result = await prisma.$transaction(async (tx) => {
        return await consume(
          tx,
          testData.customerId,
          consumeAmount,
          'test-operator',
          '测试消费',
          undefined,
          testData.storeId
        );
      });

      transactionId = result.transaction.id;
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${transactionId}`
      );
      idempotencyKeys.push(idempotencyKey);

      expect(result.account.balance.toString()).toBe('400.00');
      expect(result.transaction.amount.toString()).toBe('100.00');
      expect(result.transaction.type).toBe(MembershipTransactionType.CONSUME);
      expect(result.transaction.status).toBe(MembershipTransactionStatus.SUCCESS);
      expect(result.transaction.balanceAfter.toString()).toBe('400.00');
      expect(result.transaction.operator).toBe('test-operator');
      expect(result.transaction.remark).toBe('测试消费');
      expect(result.transaction.storeId).toBe(testData.storeId);

      const updatedAccount = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(updatedAccount?.balance.toString()).toBe('400.00');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(1);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      expect(notification?.type).toBe(NotificationType.MEMBERSHIP_BALANCE_CHANGE);
      expect(notification?.templateCode).toBe('MEMBERSHIP_BALANCE_CHANGE');
      expect(notification?.relatedTransactionId).toBe(transactionId);
      expect(notification?.relatedCustomerId).toBe(testData.customerId);
      expect(notification?.status).toBe('PENDING');
    });

    it('should handle multiple consecutive consumptions correctly', async () => {
      const amounts = [
        new Prisma.Decimal('100.00'),
        new Prisma.Decimal('150.00'),
        new Prisma.Decimal('50.00'),
      ];

      for (let i = 0; i < amounts.length; i++) {
        const result = await prisma.$transaction(async (tx) => {
          return await consume(
            tx,
            testData.customerId,
            amounts[i],
            `operator-${i}`,
            `消费 ${i + 1}`,
            undefined,
            testData.storeId
          );
        });

        const key = generateIdempotencyKey(
          NotificationType.MEMBERSHIP_BALANCE_CHANGE,
          `transaction:${result.transaction.id}`
        );
        idempotencyKeys.push(key);
      }

      const finalAccount = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(finalAccount?.balance.toString()).toBe('200.00');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(3);

      const notificationCount = await countNotifications(idempotencyKeys);
      expect(notificationCount).toBe(3);
    });

    it('should create transaction with booking association when using consumeWithBooking', async () => {
      let bookingId: number;
      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.PENDING,
        });
        bookingId = booking.id;
      });

      const consumeAmount = new Prisma.Decimal('200.00');
      const result = await prisma.$transaction(async (tx) => {
        return await consumeWithBooking(
          tx,
          bookingId!,
          testData.customerId,
          consumeAmount,
          testData.storeId,
          'test-operator',
          '预约消费'
        );
      });

      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${result.transaction.id}`
      );
      idempotencyKeys.push(idempotencyKey);

      expect(result.account.balance.toString()).toBe('300.00');
      expect(result.transaction.amount.toString()).toBe('200.00');
      expect(result.transaction.relatedBookingId).toBe(bookingId);
      expect(result.transaction.storeId).toBe(testData.storeId);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      expect(notification?.relatedBookingId).toBe(bookingId);
      expect(notification?.relatedTransactionId).toBe(result.transaction.id);
    });
  });

  describe('Insufficient balance scenarios', () => {
    it('should throw error and not create transaction when balance is insufficient', async () => {
      const initialAccount = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(initialAccount?.balance.toString()).toBe('500.00');

      const excessiveAmount = new Prisma.Decimal('600.00');

      await expect(
        prisma.$transaction(async (tx) => {
          return await consume(
            tx,
            testData.customerId,
            excessiveAmount,
            'test-operator',
            '超额消费',
            undefined,
            testData.storeId
          );
        })
      ).rejects.toThrow('余额不足');

      const accountAfterAttempt = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(accountAfterAttempt?.balance.toString()).toBe('500.00');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(0);

      const notifications = await prisma.notificationTask.findMany({
        where: { relatedCustomerId: testData.customerId },
      });
      expect(notifications.length).toBe(0);
    });

    it('should handle edge case: exact balance consumption', async () => {
      const exactAmount = new Prisma.Decimal('500.00');

      const result = await prisma.$transaction(async (tx) => {
        return await consume(
          tx,
          testData.customerId,
          exactAmount,
          'test-operator',
          '全额消费',
          undefined,
          testData.storeId
        );
      });

      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${result.transaction.id}`
      );
      idempotencyKeys.push(idempotencyKey);

      expect(result.account.balance.toString()).toBe('0.00');
      expect(result.transaction.balanceAfter.toString()).toBe('0.00');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(1);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should fail when consuming more than available after partial consumption', async () => {
      await prisma.$transaction(async (tx) => {
        return await consume(
          tx,
          testData.customerId,
          new Prisma.Decimal('400.00'),
          'operator-1',
          '第一次消费',
          undefined,
          testData.storeId
        );
      });

      const accountAfterFirst = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(accountAfterFirst?.balance.toString()).toBe('100.00');

      await expect(
        prisma.$transaction(async (tx) => {
          return await consume(
            tx,
            testData.customerId,
            new Prisma.Decimal('200.00'),
            'operator-2',
            '超额消费',
            undefined,
            testData.storeId
          );
        })
      ).rejects.toThrow('余额不足');

      const accountAfterSecond = await prisma.membershipAccount.findUnique({
        where: { id: testData.membershipAccountId! },
      });
      expect(accountAfterSecond?.balance.toString()).toBe('100.00');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(1);
    });
  });

  describe('Recharge and refund operations', () => {
    it('should create transaction and notification for recharge', async () => {
      const rechargeAmount = new Prisma.Decimal('300.00');

      const result = await prisma.$transaction(async (tx) => {
        return await recharge(
          tx,
          testData.customerId,
          rechargeAmount,
          'test-operator',
          '会员充值',
          testData.storeId
        );
      });

      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${result.transaction.id}`
      );
      idempotencyKeys.push(idempotencyKey);

      expect(result.account.balance.toString()).toBe('800.00');
      expect(result.transaction.amount.toString()).toBe('300.00');
      expect(result.transaction.type).toBe(MembershipTransactionType.RECHARGE);
      expect(result.transaction.balanceAfter.toString()).toBe('800.00');

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      expect((notification?.templateParams as any)?.type).toBe('RECHARGE');
    });

    it('should create transaction and notification for refund', async () => {
      const refundAmount = new Prisma.Decimal('100.00');

      const result = await prisma.$transaction(async (tx) => {
        return await refund(
          tx,
          testData.customerId,
          refundAmount,
          'test-operator',
          '退款测试',
          undefined,
          testData.storeId
        );
      });

      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${result.transaction.id}`
      );
      idempotencyKeys.push(idempotencyKey);

      expect(result.account.balance.toString()).toBe('600.00');
      expect(result.transaction.amount.toString()).toBe('100.00');
      expect(result.transaction.type).toBe(MembershipTransactionType.REFUND);
      expect(result.transaction.balanceAfter.toString()).toBe('600.00');

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      expect((notification?.templateParams as any)?.type).toBe('REFUND');
    });
  });

  describe('Account validation', () => {
    it('should throw error when customer has no membership account', async () => {
      const customerWithoutMembership = await createTestCustomer();

      await expect(
        prisma.$transaction(async (tx) => {
          return await consume(
            tx,
            customerWithoutMembership.id,
            new Prisma.Decimal('100.00'),
            'test-operator',
            '测试消费',
            undefined,
            testData.storeId
          );
        })
      ).rejects.toThrow('该顾客未开通会员');

      await prisma.customer.delete({ where: { id: customerWithoutMembership.id } });
    });

    it('should throw error when membership account is inactive', async () => {
      await prisma.membershipAccount.update({
        where: { id: testData.membershipAccountId! },
        data: { isActive: false },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return await consume(
            tx,
            testData.customerId,
            new Prisma.Decimal('100.00'),
            'test-operator',
            '测试消费',
            undefined,
            testData.storeId
          );
        })
      ).rejects.toThrow('会员账户已冻结');

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(0);
    });
  });

  describe('consumeWithBooking validation', () => {
    it('should throw error when booking does not exist', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await consumeWithBooking(
            tx,
            99999,
            testData.customerId,
            new Prisma.Decimal('100.00'),
            testData.storeId,
            'test-operator',
            '预约消费'
          );
        })
      ).rejects.toThrow('预约不存在');
    });

    it('should throw error when booking belongs to different customer', async () => {
      const otherCustomer = await createTestCustomer();
      let bookingId: number;

      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: otherCustomer.id,
          playerCount: 2,
          status: BookingStatus.PENDING,
        });
        bookingId = booking.id;
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return await consumeWithBooking(
            tx,
            bookingId!,
            testData.customerId,
            new Prisma.Decimal('100.00'),
            testData.storeId,
            'test-operator',
            '预约消费'
          );
        })
      ).rejects.toThrow('预约不属于该顾客');

      await prisma.booking.delete({ where: { id: bookingId! } });
      await prisma.customer.delete({ where: { id: otherCustomer.id } });
    });

    it('should throw error when booking belongs to different store', async () => {
      let bookingId: number;
      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.PENDING,
        });
        bookingId = booking.id;
      });

      const otherStore = await prisma.store.create({
        data: {
          name: 'Other Store',
          address: 'Other Address',
          phone: '13800000000',
        },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          return await consumeWithBooking(
            tx,
            bookingId!,
            testData.customerId,
            new Prisma.Decimal('100.00'),
            otherStore.id,
            'test-operator',
            '预约消费'
          );
        })
      ).rejects.toThrow('预约不属于该门店');

      await prisma.booking.delete({ where: { id: bookingId! } });
      await prisma.store.delete({ where: { id: otherStore.id } });
    });
  });

  describe('Transaction history integrity', () => {
    it('should maintain correct balance history across multiple operations', async () => {
      const operations = [
        { type: 'recharge', amount: new Prisma.Decimal('200.00'), expectedBalance: '700.00' },
        { type: 'consume', amount: new Prisma.Decimal('300.00'), expectedBalance: '400.00' },
        { type: 'consume', amount: new Prisma.Decimal('100.00'), expectedBalance: '300.00' },
        { type: 'refund', amount: new Prisma.Decimal('50.00'), expectedBalance: '350.00' },
        { type: 'consume', amount: new Prisma.Decimal('350.00'), expectedBalance: '0.00' },
      ];

      for (const op of operations) {
        let result: any;
        if (op.type === 'recharge') {
          result = await prisma.$transaction(async (tx) => {
            return recharge(tx, testData.customerId, op.amount, 'op', undefined, testData.storeId);
          });
        } else if (op.type === 'consume') {
          result = await prisma.$transaction(async (tx) => {
            return consume(tx, testData.customerId, op.amount, 'op', undefined, undefined, testData.storeId);
          });
        } else if (op.type === 'refund') {
          result = await prisma.$transaction(async (tx) => {
            return refund(tx, testData.customerId, op.amount, 'op', undefined, undefined, testData.storeId);
          });
        }

        const key = generateIdempotencyKey(
          NotificationType.MEMBERSHIP_BALANCE_CHANGE,
          `transaction:${result.transaction.id}`
        );
        idempotencyKeys.push(key);

        expect(result.account.balance.toString()).toBe(op.expectedBalance);
        expect(result.transaction.balanceAfter.toString()).toBe(op.expectedBalance);
      }

      const transactionCount = await countTransactions(testData.membershipAccountId!);
      expect(transactionCount).toBe(operations.length);

      const notificationCount = await countNotifications(idempotencyKeys);
      expect(notificationCount).toBe(operations.length);

      const transactions = await prisma.membershipTransaction.findMany({
        where: { accountId: testData.membershipAccountId! },
        orderBy: { createdAt: 'asc' },
      });

      let runningBalance = new Prisma.Decimal('500.00');
      for (const tx of transactions) {
        if (tx.type === MembershipTransactionType.RECHARGE || tx.type === MembershipTransactionType.REFUND) {
          runningBalance = runningBalance.plus(tx.amount);
        } else if (tx.type === MembershipTransactionType.CONSUME) {
          runningBalance = runningBalance.minus(tx.amount);
        }
        expect(tx.balanceAfter.toString()).toBe(runningBalance.toString());
      }
    });
  });
});
