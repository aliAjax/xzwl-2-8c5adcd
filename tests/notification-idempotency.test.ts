import {
  Prisma,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  BookingStatus,
} from '@prisma/client';
import prisma from '../src/prisma/client';
import {
  createFullTestEnvironment,
  cleanupTestData,
  TestDataIds,
  countNotifications,
  cleanupNotificationTasks,
  generatePhone,
} from './helpers';
import { createBookingWithSessionUpdate } from '../src/modules/booking/booking.service';
import { consume } from '../src/modules/membership/membership.service';
import {
  createNotificationTask,
  generateIdempotencyKey,
} from '../src/modules/notification/notification.service';
import {
  SessionStartReminderParams,
  SessionCancelledParams,
  WaitlistConfirmedParams,
  MembershipBalanceChangeParams,
} from '../src/modules/notification/types';

describe('Notification Idempotency Key Prevention', () => {
  let testData: TestDataIds;
  let idempotencyKeys: string[] = [];

  const createTestBooking = async (playerCount = 1): Promise<number> => {
    return prisma.$transaction(async (tx) => {
      const booking = await createBookingWithSessionUpdate(tx, {
        sessionId: testData.sessionId,
        customerId: testData.customerId,
        playerCount,
        status: BookingStatus.CONFIRMED,
      });
      return booking.id;
    });
  };

  const createTestTransaction = async (
    amount = new Prisma.Decimal('100.00')
  ): Promise<number> => {
    const result = await prisma.$transaction(async (tx) => {
      return consume(
        tx,
        testData.customerId,
        amount,
        'test-operator',
        '幂等通知测试消费',
        undefined,
        testData.storeId
      );
    });
    return result.transaction.id;
  };

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

  describe('generateIdempotencyKey', () => {
    it('should generate consistent idempotency keys', () => {
      const key1 = generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, 'booking:123');
      const key2 = generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, 'booking:123');
      const key3 = generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, 'booking:456');
      const key4 = generateIdempotencyKey(NotificationType.SESSION_CANCELLED, 'booking:123');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).not.toBe(key4);
      expect(key1).toBe('SESSION_START_REMINDER:booking:123');
    });

    it('should handle numeric business IDs correctly', () => {
      const key1 = generateIdempotencyKey(NotificationType.WAITLIST_CONFIRMED, 456);
      const key2 = generateIdempotencyKey(NotificationType.WAITLIST_CONFIRMED, '456');

      expect(key1).toBe(key2);
      expect(key1).toBe('WAITLIST_CONFIRMED:456');
    });
  });

  describe('createNotificationTask idempotency', () => {
    it('should return existing task when same idempotency key is used', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.SESSION_START_REMINDER,
        `booking:${bookingId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: SessionStartReminderParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 2,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: '13800000000',
      };

      const task1 = await createNotificationTask({
        type: NotificationType.SESSION_START_REMINDER,
        channel: NotificationChannel.SMS,
        recipient,
        templateCode: 'SESSION_START_REMINDER',
        templateParams,
        idempotencyKey,
        relatedBookingId: bookingId,
        relatedSessionId: testData.sessionId,
        relatedCustomerId: testData.customerId,
      });

      const task2 = await createNotificationTask({
        type: NotificationType.SESSION_START_REMINDER,
        channel: NotificationChannel.SMS,
        recipient,
        templateCode: 'SESSION_START_REMINDER',
        templateParams,
        idempotencyKey,
        relatedBookingId: bookingId,
        relatedSessionId: testData.sessionId,
        relatedCustomerId: testData.customerId,
      });

      expect(task1.id).toBe(task2.id);
      expect(task1.idempotencyKey).toBe(task2.idempotencyKey);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should create separate tasks for different idempotency keys', async () => {
      const bookingId1 = await createTestBooking();
      const bookingId2 = await createTestBooking();
      const key1 = generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, `booking:${bookingId1}`);
      const key2 = generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, `booking:${bookingId2}`);
      idempotencyKeys.push(key1, key2);

      const templateParams: SessionStartReminderParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 2,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: '13800000000',
      };

      const task1 = await createNotificationTask({
        type: NotificationType.SESSION_START_REMINDER,
        channel: NotificationChannel.SMS,
        recipient,
        templateCode: 'SESSION_START_REMINDER',
        templateParams,
        idempotencyKey: key1,
        relatedBookingId: bookingId1,
        relatedSessionId: testData.sessionId,
        relatedCustomerId: testData.customerId,
      });

      const task2 = await createNotificationTask({
        type: NotificationType.SESSION_START_REMINDER,
        channel: NotificationChannel.SMS,
        recipient,
        templateCode: 'SESSION_START_REMINDER',
        templateParams,
        idempotencyKey: key2,
        relatedBookingId: bookingId2,
        relatedSessionId: testData.sessionId,
        relatedCustomerId: testData.customerId,
      });

      expect(task1.id).not.toBe(task2.id);
      expect(task1.idempotencyKey).not.toBe(task2.idempotencyKey);

      const notificationCount = await countNotifications([key1, key2]);
      expect(notificationCount).toBe(2);
    });

    it('should handle concurrent calls with same idempotency key correctly', async () => {
      const transactionId = await createTestTransaction();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${transactionId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: MembershipBalanceChangeParams = {
        transactionId,
        type: 'CONSUME',
        amount: '100.00',
        balanceAfter: '400.00',
        remark: '测试消费',
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: '13800000000',
      };

      const taskPromises = Array(5).fill(null).map(() =>
        createNotificationTask({
          type: NotificationType.MEMBERSHIP_BALANCE_CHANGE,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'MEMBERSHIP_BALANCE_CHANGE',
          templateParams,
          idempotencyKey,
          relatedTransactionId: transactionId,
          relatedCustomerId: testData.customerId,
        })
      );

      const results = await Promise.all(taskPromises);

      const taskIds = results.map(r => r.id);
      const uniqueTaskIds = [...new Set(taskIds)];
      expect(uniqueTaskIds.length).toBe(1);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should work correctly within a transaction', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        'waitlist:tx-test-1'
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: WaitlistConfirmedParams = {
        waitlistId: 1,
        bookingId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 2,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: '13800000000',
      };

      const result = await prisma.$transaction(async (tx) => {
        const task1 = await createNotificationTask({
          type: NotificationType.WAITLIST_CONFIRMED,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'WAITLIST_CONFIRMED',
          templateParams,
          idempotencyKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        }, tx);

        const task2 = await createNotificationTask({
          type: NotificationType.WAITLIST_CONFIRMED,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'WAITLIST_CONFIRMED',
          templateParams,
          idempotencyKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        }, tx);

        return { task1, task2 };
      });

      expect(result.task1.id).toBe(result.task2.id);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });
  });

  describe('Idempotency across notification types', () => {
    it('should prevent duplicate SESSION_START_REMINDER notifications', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.SESSION_START_REMINDER,
        `booking:${bookingId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: SessionStartReminderParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 2,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: generatePhone(),
      };

      for (let i = 0; i < 3; i++) {
        await createNotificationTask({
          type: NotificationType.SESSION_START_REMINDER,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'SESSION_START_REMINDER',
          templateParams,
          idempotencyKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        });
      }

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      expect(notification?.type).toBe(NotificationType.SESSION_START_REMINDER);
      expect(notification?.relatedBookingId).toBe(bookingId);
    });

    it('should prevent duplicate SESSION_CANCELLED notifications', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.SESSION_CANCELLED,
        `booking:${bookingId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: SessionCancelledParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        startTime: '2024-01-01 10:00:00',
        reason: '商家取消',
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: generatePhone(),
      };

      await Promise.all([
        createNotificationTask({
          type: NotificationType.SESSION_CANCELLED,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'SESSION_CANCELLED',
          templateParams,
          idempotencyKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        }),
        createNotificationTask({
          type: NotificationType.SESSION_CANCELLED,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'SESSION_CANCELLED',
          templateParams,
          idempotencyKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        }),
      ]);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should prevent duplicate WAITLIST_CONFIRMED notifications', async () => {
      const bookingId = await createTestBooking();
      const waitlistId = 2001;
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        `waitlist:${waitlistId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: WaitlistConfirmedParams = {
        waitlistId,
        bookingId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 3,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: generatePhone(),
      };

      for (let i = 0; i < 5; i++) {
        await prisma.$transaction(async (tx) => {
          await createNotificationTask({
            type: NotificationType.WAITLIST_CONFIRMED,
            channel: NotificationChannel.SMS,
            recipient,
            templateCode: 'WAITLIST_CONFIRMED',
            templateParams,
            idempotencyKey,
            relatedBookingId: bookingId,
            relatedSessionId: testData.sessionId,
            relatedCustomerId: testData.customerId,
          }, tx);
        });
      }

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should prevent duplicate MEMBERSHIP_BALANCE_CHANGE notifications', async () => {
      const transactionId = await createTestTransaction(new Prisma.Decimal('150.00'));
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.MEMBERSHIP_BALANCE_CHANGE,
        `transaction:${transactionId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: MembershipBalanceChangeParams = {
        transactionId,
        type: 'CONSUME',
        amount: '150.00',
        balanceAfter: '350.00',
        remark: '预约消费',
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: generatePhone(),
      };

      const createTasks = Array(4).fill(null).map(() =>
        createNotificationTask({
          type: NotificationType.MEMBERSHIP_BALANCE_CHANGE,
          channel: NotificationChannel.SMS,
          recipient,
          templateCode: 'MEMBERSHIP_BALANCE_CHANGE',
          templateParams,
          idempotencyKey,
          relatedTransactionId: transactionId,
          relatedCustomerId: testData.customerId,
        })
      );

      await Promise.all(createTasks);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);

      const notification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey },
      });
      const params = notification?.templateParams as unknown as MembershipBalanceChangeParams;
      expect(params.type).toBe('CONSUME');
      expect(params.amount).toBe('150.00');
    });
  });

  describe('Idempotency in real business scenarios', () => {
    it('should not create duplicate notifications when booking creation is retried', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.SESSION_START_REMINDER,
        `booking:${bookingId}`
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: SessionStartReminderParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 14:00:00',
        playerCount: 4,
        storeName: 'Test Store',
      };

      const customer = await prisma.customer.findUnique({
        where: { id: testData.customerId },
      });

      const simulateBookingCreation = async () => {
        const existingNotification = await prisma.notificationTask.findUnique({
          where: { idempotencyKey },
        });

        if (!existingNotification && customer) {
          await createNotificationTask({
            type: NotificationType.SESSION_START_REMINDER,
            channel: NotificationChannel.SMS,
            recipient: {
              name: customer.name,
              phone: customer.phone,
            },
            templateCode: 'SESSION_START_REMINDER',
            templateParams,
            idempotencyKey,
            relatedBookingId: bookingId,
            relatedSessionId: testData.sessionId,
            relatedCustomerId: testData.customerId,
          });
        }
      };

      await Promise.all([
        simulateBookingCreation(),
        simulateBookingCreation(),
        simulateBookingCreation(),
      ]);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should handle different notification types for same booking independently', async () => {
      const bookingId = await createTestBooking();
      const startKey = generateIdempotencyKey(
        NotificationType.SESSION_START_REMINDER,
        `booking:${bookingId}`
      );
      const cancelKey = generateIdempotencyKey(
        NotificationType.SESSION_CANCELLED,
        `booking:${bookingId}`
      );
      idempotencyKeys.push(startKey, cancelKey);

      const customer = await prisma.customer.findUnique({
        where: { id: testData.customerId },
      });

      if (customer) {
        const startParams: SessionStartReminderParams = {
          sessionId: testData.sessionId,
          scriptName: 'Test Script',
          hostName: 'Test Host',
          roomName: 'Test Room',
          startTime: '2024-01-01 14:00:00',
          playerCount: 4,
          storeName: 'Test Store',
        };

        await createNotificationTask({
          type: NotificationType.SESSION_START_REMINDER,
          channel: NotificationChannel.SMS,
          recipient: { name: customer.name, phone: customer.phone },
          templateCode: 'SESSION_START_REMINDER',
          templateParams: startParams,
          idempotencyKey: startKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        });

        const cancelParams: SessionCancelledParams = {
          sessionId: testData.sessionId,
          scriptName: 'Test Script',
          startTime: '2024-01-01 14:00:00',
          reason: '顾客取消',
          storeName: 'Test Store',
        };

        await createNotificationTask({
          type: NotificationType.SESSION_CANCELLED,
          channel: NotificationChannel.SMS,
          recipient: { name: customer.name, phone: customer.phone },
          templateCode: 'SESSION_CANCELLED',
          templateParams: cancelParams,
          idempotencyKey: cancelKey,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        });
      }

      const totalNotifications = await countNotifications([startKey, cancelKey]);
      expect(totalNotifications).toBe(2);

      const startNotification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey: startKey },
      });
      const cancelNotification = await prisma.notificationTask.findUnique({
        where: { idempotencyKey: cancelKey },
      });

      expect(startNotification?.type).toBe(NotificationType.SESSION_START_REMINDER);
      expect(cancelNotification?.type).toBe(NotificationType.SESSION_CANCELLED);
    });
  });

  describe('Database unique constraint enforcement', () => {
    it('should enforce unique idempotency key at database level', async () => {
      const bookingId = await createTestBooking();
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.SESSION_START_REMINDER,
        'db-constraint-test'
      );
      idempotencyKeys.push(idempotencyKey);

      const templateParams: SessionStartReminderParams = {
        sessionId: testData.sessionId,
        scriptName: 'Test Script',
        hostName: 'Test Host',
        roomName: 'Test Room',
        startTime: '2024-01-01 10:00:00',
        playerCount: 2,
        storeName: 'Test Store',
      };

      const recipient = {
        name: 'Test Customer',
        phone: '13800000000',
      };

      await prisma.notificationTask.create({
        data: {
          type: NotificationType.SESSION_START_REMINDER,
          channel: NotificationChannel.SMS,
          status: NotificationStatus.PENDING,
          idempotencyKey,
          recipientPhone: recipient.phone,
          recipientName: recipient.name,
          templateCode: 'SESSION_START_REMINDER',
          templateParams: templateParams as unknown as Prisma.JsonObject,
          maxSendCount: 3,
          relatedBookingId: bookingId,
          relatedSessionId: testData.sessionId,
          relatedCustomerId: testData.customerId,
        },
      });

      await expect(
        prisma.notificationTask.create({
          data: {
            type: NotificationType.SESSION_START_REMINDER,
            channel: NotificationChannel.SMS,
            status: NotificationStatus.PENDING,
            idempotencyKey,
            recipientPhone: recipient.phone,
            recipientName: recipient.name,
            templateCode: 'SESSION_START_REMINDER',
            templateParams: templateParams as unknown as Prisma.JsonObject,
            maxSendCount: 3,
            relatedBookingId: bookingId,
            relatedSessionId: testData.sessionId,
            relatedCustomerId: testData.customerId,
          },
        })
      ).rejects.toThrow();

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });
  });
});
