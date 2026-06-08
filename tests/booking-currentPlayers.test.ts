import { Prisma, BookingStatus } from '@prisma/client';
import prisma from '../src/prisma/client';
import {
  createFullTestEnvironment,
  cleanupTestData,
  getCurrentPlayers,
  createTestCustomer,
  TestDataIds,
  generatePhone,
} from './helpers';
import {
  createBookingWithSessionUpdate,
  deleteBookingWithSessionUpdate,
  updateBookingPlayerCount,
  validatePlayerCount,
} from '../src/modules/booking/booking.service';

describe('Booking CurrentPlayers Consistency', () => {
  let testData: TestDataIds;
  let customer2Id: number;

  beforeEach(async () => {
    testData = await createFullTestEnvironment({
      maxPlayers: 6,
      currentPlayers: 0,
    });
    const customer2 = await createTestCustomer();
    customer2Id = customer2.id;
  });

  afterEach(async () => {
    await cleanupTestData(testData);
    await prisma.customer.deleteMany({ where: { id: customer2Id } });
  });

  describe('createBookingWithSessionUpdate', () => {
    it('should increment currentPlayers correctly when creating a booking', async () => {
      const initialPlayers = await getCurrentPlayers(testData.sessionId);
      expect(initialPlayers).toBe(0);

      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
        expect(booking).toBeDefined();
        expect(booking.playerCount).toBe(2);
      });

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);
    });

    it('should increment currentPlayers correctly for multiple bookings', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);

      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: customer2Id,
          playerCount: 3,
          status: BookingStatus.CONFIRMED,
        });
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(5);
    });

    it('should handle concurrent bookings correctly', async () => {
      const bookingPromises = [1, 2, 3].map((i) =>
        prisma.$transaction(async (tx) => {
          const customer = await tx.customer.create({
            data: {
              name: `Concurrent Customer ${i}`,
              phone: generatePhone(),
            },
          });
          return createBookingWithSessionUpdate(tx, {
            sessionId: testData.sessionId,
            customerId: customer.id,
            playerCount: 1,
            status: BookingStatus.CONFIRMED,
          });
        })
      );

      await Promise.all(bookingPromises);

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(3);

      const bookingCount = await prisma.booking.count({
        where: { sessionId: testData.sessionId },
      });
      expect(bookingCount).toBe(3);
    });

    it('should not create booking when maxPlayers is exceeded', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 5,
          status: BookingStatus.CONFIRMED,
        });
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(5);

      await expect(
        prisma.$transaction(async (tx) => {
          const session = await tx.session.findUnique({
            where: { id: testData.sessionId },
          });
          validatePlayerCount(session!.currentPlayers, session!.maxPlayers, 2);
          await createBookingWithSessionUpdate(tx, {
            sessionId: testData.sessionId,
            customerId: customer2Id,
            playerCount: 2,
            status: BookingStatus.CONFIRMED,
          });
        })
      ).rejects.toThrow();

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(5);
    });
  });

  describe('deleteBookingWithSessionUpdate', () => {
    it('should decrement currentPlayers correctly when deleting a booking', async () => {
      let bookingId: number;
      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 3,
          status: BookingStatus.CONFIRMED,
        });
        bookingId = booking.id;
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(3);

      await prisma.$transaction(async (tx) => {
        await deleteBookingWithSessionUpdate(tx, bookingId!, testData.sessionId, 3);
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(0);
    });

    it('should handle partial deletions correctly with multiple bookings', async () => {
      let booking1Id: number;
      let booking2Id: number;

      await prisma.$transaction(async (tx) => {
        const booking1 = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
        booking1Id = booking1.id;

        const booking2 = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: customer2Id,
          playerCount: 3,
          status: BookingStatus.CONFIRMED,
        });
        booking2Id = booking2.id;
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(5);

      await prisma.$transaction(async (tx) => {
        await deleteBookingWithSessionUpdate(tx, booking1Id!, testData.sessionId, 2);
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(3);

      await prisma.$transaction(async (tx) => {
        await deleteBookingWithSessionUpdate(tx, booking2Id!, testData.sessionId, 3);
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(0);
    });
  });

  describe('updateBookingPlayerCount', () => {
    it('should update currentPlayers correctly when increasing player count', async () => {
      let bookingId: number;
      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
        bookingId = booking.id;
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);

      await prisma.$transaction(async (tx) => {
        await updateBookingPlayerCount(tx, testData.sessionId, 2, 4);
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(4);
    });

    it('should update currentPlayers correctly when decreasing player count', async () => {
      let bookingId: number;
      await prisma.$transaction(async (tx) => {
        const booking = await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 4,
          status: BookingStatus.CONFIRMED,
        });
        bookingId = booking.id;
      });

      let currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(4);

      await prisma.$transaction(async (tx) => {
        await updateBookingPlayerCount(tx, testData.sessionId, 4, 2);
      });

      currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);
    });

    it('should throw error when update exceeds maxPlayers', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 4,
          status: BookingStatus.CONFIRMED,
        });
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await updateBookingPlayerCount(tx, testData.sessionId, 4, 7);
        })
      ).rejects.toThrow('人数超出场次最大限制');

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(4);
    });

    it('should throw error when update results in negative players', async () => {
      await prisma.$transaction(async (tx) => {
        await createBookingWithSessionUpdate(tx, {
          sessionId: testData.sessionId,
          customerId: testData.customerId,
          playerCount: 2,
          status: BookingStatus.CONFIRMED,
        });
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await updateBookingPlayerCount(tx, testData.sessionId, 2, -1);
        })
      ).rejects.toThrow('人数不能为负数');

      const currentPlayers = await getCurrentPlayers(testData.sessionId);
      expect(currentPlayers).toBe(2);
    });
  });

  describe('validatePlayerCount', () => {
    it('should pass validation when player count is within limits', () => {
      expect(() => validatePlayerCount(2, 6, 3)).not.toThrow();
      expect(() => validatePlayerCount(0, 6, 6)).not.toThrow();
      expect(() => validatePlayerCount(5, 6, 1)).not.toThrow();
    });

    it('should fail validation when player count exceeds maxPlayers', () => {
      expect(() => validatePlayerCount(5, 6, 2)).toThrow();
      expect(() => validatePlayerCount(6, 6, 1)).toThrow();
    });

    it('should fail validation when result is negative', () => {
      expect(() => validatePlayerCount(0, 6, -1)).toThrow('人数不能为负数');
    });

    it('should handle existingCount parameter correctly', () => {
      expect(() => validatePlayerCount(5, 6, 3, 2)).not.toThrow();
      expect(() => validatePlayerCount(5, 6, 4, 2)).toThrow();
    });
  });
});
