import { Response, NextFunction } from 'express'
import { Prisma, BookingStatus } from '@prisma/client'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  bookingSchema,
  bookingUpdateSchema,
  bookingQuerySchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'
import {
  validatePlayerCount,
  createBookingWithSessionUpdate,
  updateBookingPlayerCount,
  deleteBookingWithSessionUpdate,
  getOrCreateCustomer,
  getActiveMembershipAccount,
  customerWithMembershipSelect,
  MembershipAccountInfo,
} from './booking.service'
import { processPendingWaitlists, WaitlistProcessResult } from '../waitlist/waitlist.service'
import { consume as membershipConsume } from '../membership/membership.service'
import { tryCreateNotificationForEventIsolated } from '../notification/notification.service'
import { SessionStartReminderParams, SessionCancelledParams } from '../notification/types'

const enrichBookingWithMembership = <T extends { customer?: any }>(booking: T): T & { membershipAccount?: MembershipAccountInfo | null } => {
  const result: any = { ...booking }
  if (booking.customer) {
    result.membershipAccount = getActiveMembershipAccount(booking.customer)
  }
  return result
}

type CreateBookingRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof bookingSchema>
>

type UpdateBookingRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof bookingUpdateSchema>
>

type GetBookingListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof bookingQuerySchema>,
  Record<string, never>
>

type GetBookingByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

export const createBooking = async (req: CreateBookingRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, sessionId, customerName, customerPhone, playerCount, status, remark, useMembership, membershipAmount, operator } = req.body

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { script: true, store: true },
    })

    if (!session) {
      throw new AppError('场次不存在', 404)
    }

    if (storeId !== undefined && session.storeId !== storeId) {
      throw new AppError('场次不属于该门店', 400)
    }

    if (session.status === 'CANCELLED') {
      throw new AppError('场次已取消，无法预约', 400)
    }

    validatePlayerCount(session.currentPlayers, session.maxPlayers, playerCount)

    if (useMembership && membershipAmount === undefined) {
      throw new AppError('使用会员余额时必须指定消费金额', 400)
    }

    const result = await prisma.$transaction(async (tx) => {
      const customer = await getOrCreateCustomer(tx, customerName, customerPhone)

      const newBooking = await createBookingWithSessionUpdate(tx, {
        sessionId,
        customerId: customer.id,
        playerCount,
        status,
        remark,
      })

      let membershipResult = null
      if (useMembership && membershipAmount !== undefined) {
        membershipResult = await membershipConsume(
          tx,
          customer.id,
          new Prisma.Decimal(membershipAmount),
          operator,
          `预约消费: ${session.script.name}`,
          newBooking.id
        )
      }

      return { booking: newBooking, membership: membershipResult }
    })

    let response: any = enrichBookingWithMembership(result.booking)
    if (result.membership) {
      response.membershipTransaction = result.membership.transaction
    }

    const bookingWithDetails = await prisma.booking.findUnique({
      where: { id: result.booking.id },
      include: {
        session: {
          include: { script: true, host: true, room: true, store: true }
        },
        customer: true
      }
    })

    if (bookingWithDetails?.session && bookingWithDetails?.customer) {
      const templateParams: Omit<SessionStartReminderParams, 'storeName'> = {
        sessionId: bookingWithDetails.session.id,
        scriptName: bookingWithDetails.session.script.name,
        hostName: bookingWithDetails.session.host?.name || '',
        roomName: bookingWithDetails.session.room?.name || '',
        startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
        playerCount: bookingWithDetails.playerCount,
      }

      await tryCreateNotificationForEventIsolated(
        { type: 'SESSION_START_REMINDER', bookingId: result.booking.id },
        {
          recipient: {
            name: bookingWithDetails.customer.name,
            phone: bookingWithDetails.customer.phone
          },
          templateParams,
          storeId: bookingWithDetails.session.storeId,
          relatedBookingId: result.booking.id,
          relatedSessionId: bookingWithDetails.session.id,
          relatedCustomerId: bookingWithDetails.customerId
        }
      )
    }

    res.sendSuccess(response, result.membership ? '预约成功，已从会员余额扣款' : '预约成功')
  } catch (error) {
    next(error)
  }
}

export const getBookingList = async (req: GetBookingListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, sessionId, customerId, status, keyword, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (sessionId) where.sessionId = sessionId
    if (customerId) where.customerId = customerId
    if (status) where.status = status
    if (storeId) where.session = { storeId }
    if (keyword) {
      where.OR = [
        {
          customer: {
            name: { contains: keyword },
          },
        },
        {
          customer: {
            phone: { contains: keyword },
          },
        },
        {
          session: {
            room: {
              name: { contains: keyword },
            },
          },
        },
      ]
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          session: {
            include: {
              script: { select: { id: true, name: true } },
              host: { select: { id: true, name: true } },
              store: { select: { id: true, name: true } },
            },
          },
          customer: { select: customerWithMembershipSelect },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.booking.count({ where }),
    ])

    const enrichedBookings = bookings.map(booking => enrichBookingWithMembership(booking))
    res.sendSuccess(createPaginationResult(enrichedBookings, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getBookingById = async (req: GetBookingByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId } = req.query

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            script: true,
            host: { select: { id: true, name: true, phone: true } },
            store: { select: { id: true, name: true } },
          },
        },
        customer: {
          include: {
            membershipAccount: {
              select: {
                id: true,
                balance: true,
                isActive: true,
              },
            },
          },
        },
      },
    })

    if (!booking) {
      throw new AppError('预约记录不存在', 404)
    }

    if (storeId !== undefined && booking.session.storeId !== storeId) {
      throw new AppError('预约不属于该门店', 404)
    }

    res.sendSuccess(enrichBookingWithMembership(booking))
  } catch (error) {
    next(error)
  }
}

export const updateBooking = async (req: UpdateBookingRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { status, playerCount, remark, useMembership, membershipAmount, operator } = req.body

    const existingBooking = await prisma.booking.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            script: true,
            store: true,
          },
        },
      },
    })

    if (!existingBooking) {
      throw new AppError('预约记录不存在', 404)
    }

    const playerCountChanged = playerCount !== undefined && playerCount !== existingBooking.playerCount
    const playerCountDecreased = playerCountChanged && playerCount! < existingBooking.playerCount
    const statusChangedToCancelled = status === 'CANCELLED' && existingBooking.status !== 'CANCELLED'
    const statusChangedFromCancelled = status !== undefined && status !== 'CANCELLED' && existingBooking.status === 'CANCELLED'
    const statusChangedToConfirmed = status === 'CONFIRMED' && existingBooking.status !== 'CONFIRMED'
    const shouldProcessWaitlist = playerCountDecreased || statusChangedToCancelled
    const bookingWasActive = existingBooking.status !== 'CANCELLED'

    if (useMembership && membershipAmount === undefined) {
      throw new AppError('使用会员余额时必须指定消费金额', 400)
    }

    const shouldConsume = statusChangedToConfirmed && useMembership && membershipAmount !== undefined

    const result = await prisma.$transaction(async (tx) => {
      const finalPlayerCount = playerCount !== undefined ? playerCount : existingBooking.playerCount

      if (statusChangedToCancelled && bookingWasActive) {
        await tx.session.update({
          where: { id: existingBooking.sessionId },
          data: {
            currentPlayers: {
              decrement: existingBooking.playerCount,
            },
          },
        })
      } else if (statusChangedFromCancelled) {
        const currentSession = await tx.session.findUnique({
          where: { id: existingBooking.sessionId },
        })
        if (currentSession) {
          validatePlayerCount(currentSession.currentPlayers, currentSession.maxPlayers, finalPlayerCount)
        }
        await tx.session.update({
          where: { id: existingBooking.sessionId },
          data: {
            currentPlayers: {
              increment: finalPlayerCount,
            },
          },
        })
      } else if (playerCountChanged && bookingWasActive) {
        await updateBookingPlayerCount(
          tx,
          existingBooking.sessionId,
          existingBooking.playerCount,
          playerCount!
        )
      }

      const updatedBooking = await tx.booking.update({
        where: { id },
        data: { status, playerCount, remark },
        include: {
          session: {
            include: {
              script: { select: { id: true, name: true } },
              host: { select: { id: true, name: true } },
              store: { select: { id: true, name: true } },
            },
          },
          customer: { select: customerWithMembershipSelect },
        },
      })

      let membershipResult = null
      if (shouldConsume) {
        membershipResult = await membershipConsume(
          tx,
          existingBooking.customerId,
          new Prisma.Decimal(membershipAmount!),
          operator,
          `确认预约消费: ${existingBooking.session.script.name}`,
          updatedBooking.id
        )
      }

      return { booking: updatedBooking, membership: membershipResult }
    })

    let waitlistResults: WaitlistProcessResult[] = []
    if (shouldProcessWaitlist) {
      waitlistResults = await processPendingWaitlists(existingBooking.sessionId)
    }

    if (statusChangedToCancelled) {
      const bookingWithDetails = await prisma.booking.findUnique({
        where: { id },
        include: {
          session: {
            include: { script: true, store: true }
          },
          customer: true
        }
      })

      if (bookingWithDetails?.session && bookingWithDetails?.customer) {
        const templateParams: Omit<SessionCancelledParams, 'storeName'> = {
          sessionId: bookingWithDetails.session.id,
          scriptName: bookingWithDetails.session.script.name,
          startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
        }

        await tryCreateNotificationForEventIsolated(
          { type: 'SESSION_CANCELLED', sessionId: bookingWithDetails.session.id, entityType: 'booking', entityId: id },
          {
            recipient: {
              name: bookingWithDetails.customer.name,
              phone: bookingWithDetails.customer.phone
            },
            templateParams,
            storeId: bookingWithDetails.session.storeId,
            relatedBookingId: id,
            relatedSessionId: bookingWithDetails.session.id,
            relatedCustomerId: bookingWithDetails.customerId
          }
        )
      }
    }

    const message = result.membership
      ? '预约确认成功，已从会员余额扣款'
      : statusChangedToConfirmed
      ? '预约确认成功'
      : statusChangedToCancelled
      ? '预约取消成功'
      : '预约更新成功'

    const response: any = {
      booking: enrichBookingWithMembership(result.booking),
      waitlistProcessed: waitlistResults.length,
      convertedWaitlists: waitlistResults,
    }

    if (result.membership) {
      response.membershipTransaction = result.membership.transaction
    }

    res.sendSuccess(response, message)
  } catch (error) {
    next(error)
  }
}

export const deleteBooking = async (req: GetBookingByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId } = req.query

    const existingBooking = await prisma.booking.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            store: true,
          },
        },
      },
    })

    if (!existingBooking) {
      throw new AppError('预约记录不存在', 404)
    }

    if (storeId !== undefined && existingBooking.session.storeId !== storeId) {
      throw new AppError('预约不属于该门店', 404)
    }

    const bookingWithDetails = await prisma.booking.findUnique({
      where: { id },
      include: {
        session: {
          include: { script: true, store: true }
        },
        customer: true
      }
    })

    await prisma.$transaction(async (tx) => {
      await deleteBookingWithSessionUpdate(
        tx,
        existingBooking.id,
        existingBooking.sessionId,
        existingBooking.playerCount
      )
    })

    const waitlistResults: WaitlistProcessResult[] = await processPendingWaitlists(existingBooking.sessionId)

    if (bookingWithDetails?.session && bookingWithDetails?.customer) {
      const templateParams: Omit<SessionCancelledParams, 'storeName'> = {
        sessionId: bookingWithDetails.session.id,
        scriptName: bookingWithDetails.session.script.name,
        startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
      }

      await tryCreateNotificationForEventIsolated(
        { type: 'SESSION_CANCELLED', sessionId: bookingWithDetails.session.id, entityType: 'booking', entityId: id },
        {
          recipient: {
            name: bookingWithDetails.customer.name,
            phone: bookingWithDetails.customer.phone
          },
          templateParams,
          storeId: bookingWithDetails.session.storeId,
          relatedBookingId: id,
          relatedSessionId: bookingWithDetails.session.id,
          relatedCustomerId: bookingWithDetails.customerId
        }
      )
    }

    res.sendSuccess(
      { waitlistProcessed: waitlistResults.length, convertedWaitlists: waitlistResults },
      '预约取消成功'
    )
  } catch (error) {
    next(error)
  }
}
