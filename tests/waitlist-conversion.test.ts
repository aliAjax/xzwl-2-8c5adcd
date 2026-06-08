import { Prisma, BookingStatus, WaitlistStatus, NotificationType } from '@prisma/client';
import prisma from '../src/prisma/client';
import {
  createFullTestEnvironment,
  cleanupTestData,
  getCurrentPlayers,
  createTestCustomer,
  TestDataIds,
  generatePhone,
  countNotifications,
  cleanupNotificationTasks,
} from './helpers';
import {
  createBookingWithSessionUpdate,
} from '../src/modules/booking/booking.service';
import {
  createWaitlist,
  processPendingWaitlists,
  confirmWaitlistToBooking,
} from '../src/modules/waitlist/waitlist.service';
import { generateIdempotencyKey } from '../src/modules/notification/notification.service';

describe('Waitlist Conversion on Booking Cancellation', () => {
  let testData: TestDataIds;
  let idempotencyKeys: string[] = [];

  beforeEach(async () => {
    testData = await createFullTestEnvironment({
      maxPlayers: 6,
      currentPlayers: 0,
    });
    idempotencyKeys = [];
  });

  afterEach(async () => {
    await cleanupNotificationTasks(idempotencyKeys);
    await cleanupTestData(testData);
  });

  describe('Basic waitlist conversion', () => {
    it('should convert waitlist to booking when booking is cancelled and seats are released', async () => {
      const customer = await prisma.customer.findUnique({
        where: { id: testData.customerId },
      });

      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(6);

      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 2,
      });

      expect(waitlist.status).toBe(WaitlistStatus.PENDING);

      await prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { sessionId: testData.sessionId },
          data: { status: BookingStatus.CANCELLED },
        });
        await tx.session.update({
          where: { id: testData.sessionId },
          data: { currentPlayers: { decrement: 6 } },
        });
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(0);

      const results = await processPendingWaitlists(testData.sessionId);
      const idempotencyKey = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        `waitlist:${waitlist.id}`
      );
      idempotencyKeys.push(idempotencyKey);

      const successfulResults = results.filter(r => r.success);
      expect(successfulResults.length).toBe(1);
      expect(successfulResults[0].waitlistId).toBe(waitlist.id);
      expect(successfulResults[0].bookingId).toBeDefined();

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);

      const updatedWaitlist = await prisma.waitlist.findUnique({
        where: { id: waitlist.id },
      });
      expect(updatedWaitlist?.status).toBe(WaitlistStatus.CONFIRMED);

      const notificationCount = await countNotifications([idempotencyKey]);
      expect(notificationCount).toBe(1);
    });

    it('should process waitlist in FIFO order', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomers = await Promise.all([
        createTestCustomer(),
        createTestCustomer(),
        createTestCustomer(),
      ]);

      const waitlists = [];
      for (let i = 0; i < waitlistCustomers.length; i++) {
        const waitlist = await createWaitlist({
          sessionId: testData.sessionId,
          customerName: waitlistCustomers[i].name,
          customerPhone: waitlistCustomers[i].phone,
          playerCount: 2,
        });
        waitlists.push(waitlist);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { sessionId: testData.sessionId },
          data: { status: BookingStatus.CANCELLED },
        });
        await tx.session.update({
          where: { id: testData.sessionId },
          data: { currentPlayers: { decrement: 6 } },
        });
      });

      const results = await processPendingWaitlists(testData.sessionId);
      
      waitlists.forEach(w => {
        const key = generateIdempotencyKey(
          NotificationType.WAITLIST_CONFIRMED,
          `waitlist:${w.id}`
        );
        idempotencyKeys.push(key);
      });

      const successfulResults = results.filter(r => r.success);
      expect(successfulResults.length).toBe(3);
      expect(successfulResults[0].waitlistId).toBe(waitlists[0].id);
      expect(successfulResults[1].waitlistId).toBe(waitlists[1].id);
      expect(successfulResults[2].waitlistId).toBe(waitlists[2].id);

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(6);
    });
  });

  describe('Boundary cases for waitlist conversion', () => {
    it('should skip waitlist entries that exceed remaining slots', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomers = await Promise.all([
        createTestCustomer(),
        createTestCustomer(),
      ]);

      const waitlist1 = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomers[0].name,
        customerPhone: waitlistCustomers[0].phone,
        playerCount: 5,
      });

      const waitlist2 = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomers[1].name,
        customerPhone: waitlistCustomers[1].phone,
        playerCount: 2,
      });

      await prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { sessionId: testData.sessionId },
          data: { status: BookingStatus.CANCELLED },
        });
        await tx.session.update({
          where: { id: testData.sessionId },
          data: { currentPlayers: { decrement: 6 } },
        });
      });

      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 4,
          status: BookingStatus.CONFIRMED,
        });
      });

      const currentPlayersBefore = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayersBefore).toBe(4);

      const results = await processPendingWaitlists(testData.sessionId);

      const key1 = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        `waitlist:${waitlist1.id}`
      );
      const key2 = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        `waitlist:${waitlist2.id}`
      );
      idempotencyKeys.push(key1, key2);

      expect(results[0].success).toBe(false);
      expect(results[0].skippedReason).toBe('INSUFFICIENT_SLOTS');

      expect(results[1].success).toBe(true);
      expect(results[1].waitlistId).toBe(waitlist2.id);

      const currentPlayersAfter = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayersAfter).toBe(6);

      const notificationCount = await countNotifications([key1, key2]);
      expect(notificationCount).toBe(1);
    });

    it('should stop processing when session becomes full', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomers = await Promise.all([
        createTestCustomer(),
        createTestCustomer(),
        createTestCustomer(),
      ]);

      const waitlists = [];
      for (let i = 0; i < waitlistCustomers.length; i++) {
        const waitlist = await createWaitlist({
          sessionId: testData.sessionId,
          customerName: waitlistCustomers[i].name,
          customerPhone: waitlistCustomers[i].phone,
          playerCount: 3,
        });
        waitlists.push(waitlist);
      }

      await prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { sessionId: testData.sessionId },
          data: { status: BookingStatus.CANCELLED },
        });
        await tx.session.update({
          where: { id: testData.sessionId },
          data: { currentPlayers: { decrement: 6 } },
        });
      });

      const results = await processPendingWaitlists(testData.sessionId);

      waitlists.forEach(w => {
        const key = generateIdempotencyKey(
          NotificationType.WAITLIST_CONFIRMED,
          `waitlist:${w.id}`
        );
        idempotencyKeys.push(key);
      });

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(false);
      expect(results[2].skippedReason).toBe('NO_REMAINING_SLOTS');

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(6);

      const notificationCount = await countNotifications(idempotencyKeys);
      expect(notificationCount).toBe(2);
    });

    it('should handle exact slot match correctly', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 6,
      });

      await prisma.$transaction(async (tx) => {
        await tx.booking.updateMany({
          where: { sessionId: testData.sessionId },
          data: { status: BookingStatus.CANCELLED },
        });
        await tx.session.update({
          where: { id: testData.sessionId },
          data: { currentPlayers: { decrement: 6 } },
        });
      });

      const results = await processPendingWaitlists(testData.sessionId);

      const key = generateIdempotencyKey(
        NotificationType.WAITLIST_CONFIRMED,
        `waitlist:${waitlist.id}`
      );
      idempotencyKeys.push(key);

      expect(results[0].success).toBe(true);

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(6);
    });

    it('should not process waitlist for cancelled session', async () => {
      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 2,
      });

      await prisma.session.update({
        where: { id: testData.sessionId },
        data: { status: 'CANCELLED' },
      });

      const results = await processPendingWaitlists(testData.sessionId);

      expect(results[0].success).toBe(false);
      expect(results[0].skippedReason).toBe('SESSION_CANCELLED');

      const updatedWaitlist = await prisma.waitlist.findUnique({
        where: { id: waitlist.id },
      });
      expect(updatedWaitlist?.status).toBe(WaitlistStatus.PENDING);
    });

    it('should not process waitlist for completed session', async () => {
      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 2,
      });

      await prisma.session.update({
        where: { id: testData.sessionId },
        data: { status: 'COMPLETED' },
      });

      const results = await processPendingWaitlists(testData.sessionId);

      expect(results[0].success).toBe(false);
      expect(results[0].skippedReason).toBe('SESSION_COMPLETED');

      const updatedWaitlist = await prisma.waitlist.findUnique({
        where: { id: waitlist.id },
      });
      expect(updatedWaitlist?.status).toBe(WaitlistStatus.PENDING);
    });
  });

  describe('confirmWaitlistToBooking edge cases', () => {
    it('should fail to confirm non-pending waitlist', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 6,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 2,
      });

      await prisma.waitlist.update({
        where: { id: waitlist.id },
        data: { status: WaitlistStatus.CANCELLED },
      });

      await expect(
        confirmWaitlistToBooking(waitlist.id)
      ).rejects.toThrow('候补状态为 CANCELLED，无法转正');
    });

    it('should handle customer with existing active booking', async () => {
      const waitlistCustomer = await createTestCustomer();

      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 4,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 2,
      });

      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: waitlistCustomer.id,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
      });

      const result = await confirmWaitlistToBooking(waitlist.id);

      expect(result.success).toBe(false);
      expect(result.message).toContain('顾客已存在同场次有效预约');

      const updatedWaitlist = await prisma.waitlist.findUnique({
        where: { id: waitlist.id },
      });
      expect(updatedWaitlist?.status).toBe(WaitlistStatus.CANCELLED);
    });

    it('should fail when session has insufficient slots during direct confirmation', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 5,
          status: BookingStatus.CONFIRMED,
        });
      });

      const waitlistCustomer = await createTestCustomer();
      const waitlist = await createWaitlist({
        sessionId: testData.sessionId,
        customerName: waitlistCustomer.name,
        customerPhone: waitlistCustomer.phone,
        playerCount: 3,
      });

      const result = await confirmWaitlistToBooking(waitlist.id);

      expect(result.success).toBe(false);
      expect(result.message).toBe('场次位置不足，无法转正');

      const updatedWaitlist = await prisma.waitlist.findUnique({
        where: { id: waitlist.id },
      });
      expect(updatedWaitlist?.status).toBe(WaitlistStatus.PENDING);
    });
  });
});
