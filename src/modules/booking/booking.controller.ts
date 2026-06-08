import { Response, NextFunction } from 'express'
import { Prisma, BookingStatus, NotificationType, NotificationChannel, NotificationStatus } from '@prisma/client'
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
} from './booking.service'
import { processPendingWaitlists } from '../waitlist/waitlist.service'
import { consume as membershipConsume } from '../membership/membership.service'
import { createNotificationTask, generateIdempotencyKey } from '../notification/notification.service'
import { SessionStartReminderParams, SessionCancelledParams } from '../notification/types'

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

    const response = result.membership
      ? { ...result.booking, membershipTransaction: result.membership.transaction }
      : result.booking

    try {
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
        const idempotencyKey = generateIdempotencyKey(
          NotificationType.SESSION_START_REMINDER,
          `booking:${result.booking.id}`
        )

        const existingNotification = await prisma.notificationTask.findUnique({
          where: { idempotencyKey }
        })

        if (!existingNotification) {
          const templateParams: SessionStartReminderParams = {
            sessionId: bookingWithDetails.session.id,
            scriptName: bookingWithDetails.session.script.name,
            hostName: bookingWithDetails.session.host?.name || '',
            roomName: bookingWithDetails.session.room?.name || '',
            startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
            playerCount: bookingWithDetails.playerCount,
            storeName: bookingWithDetails.session.store?.name
          }

          await createNotificationTask({
            type: NotificationType.SESSION_START_REMINDER,
            channel: NotificationChannel.SMS,
            recipient: {
              name: bookingWithDetails.customer.name,
              phone: bookingWithDetails.customer.phone
            },
            templateCode: 'SESSION_START_REMINDER',
            templateParams,
            idempotencyKey,
            relatedBookingId: result.booking.id,
            relatedSessionId: bookingWithDetails.session.id,
            relatedCustomerId: bookingWithDetails.customerId
          })
        }
      }
    } catch (notificationError) {
      console.error('Failed to create notification for booking creation:', notificationError)
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
          customer: { select: { id: true, name: true, phone: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.booking.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(bookings, total, page, pageSize))
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
        customer: true,
      },
    })

    if (!booking) {
      throw new AppError('预约记录不存在', 404)
    }

    if (storeId !== undefined && booking.session.storeId !== storeId) {
      throw new AppError('预约不属于该门店', 404)
    }

    res.sendSuccess(booking)
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
          customer: { select: { id: true, name: true, phone: true } },
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

    let waitlistResults: Array<{ waitlistId: number; bookingId: number; message: string }> = []
    if (shouldProcessWaitlist) {
      waitlistResults = await processPendingWaitlists(existingBooking.sessionId)
    }

    if (statusChangedToCancelled) {
      try {
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
          const idempotencyKey = generateIdempotencyKey(
            NotificationType.SESSION_CANCELLED,
            `booking:${id}`
          )

          const existingNotification = await prisma.notificationTask.findUnique({
            where: { idempotencyKey }
          })

          if (!existingNotification) {
            const templateParams: SessionCancelledParams = {
              sessionId: bookingWithDetails.session.id,
              scriptName: bookingWithDetails.session.script.name,
              startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
              storeName: bookingWithDetails.session.store?.name
            }

            await createNotificationTask({
              type: NotificationType.SESSION_CANCELLED,
              channel: NotificationChannel.SMS,
              recipient: {
                name: bookingWithDetails.customer.name,
                phone: bookingWithDetails.customer.phone
              },
              templateCode: 'SESSION_CANCELLED',
              templateParams,
              idempotencyKey,
              relatedBookingId: id,
              relatedSessionId: bookingWithDetails.session.id,
              relatedCustomerId: bookingWithDetails.customerId
            })
          }
        }
      } catch (notificationError) {
        console.error('Failed to create notification for booking cancellation:', notificationError)
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
      booking: result.booking,
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

    const waitlistResults = await processPendingWaitlists(existingBooking.sessionId)

    try {
      if (bookingWithDetails?.session && bookingWithDetails?.customer) {
        const idempotencyKey = generateIdempotencyKey(
          NotificationType.SESSION_CANCELLED,
          `booking:${id}`
        )

        const existingNotification = await prisma.notificationTask.findUnique({
          where: { idempotencyKey }
        })

        if (!existingNotification) {
          const templateParams: SessionCancelledParams = {
            sessionId: bookingWithDetails.session.id,
            scriptName: bookingWithDetails.session.script.name,
            startTime: bookingWithDetails.session.startTime.toLocaleString('zh-CN'),
            storeName: bookingWithDetails.session.store?.name
          }

          await createNotificationTask({
            type: NotificationType.SESSION_CANCELLED,
            channel: NotificationChannel.SMS,
            recipient: {
              name: bookingWithDetails.customer.name,
              phone: bookingWithDetails.customer.phone
            },
            templateCode: 'SESSION_CANCELLED',
            templateParams,
            idempotencyKey,
            relatedSessionId: bookingWithDetails.session.id,
            relatedCustomerId: bookingWithDetails.customerId
          })
        }
      }
    } catch (notificationError) {
      console.error('Failed to create notification for booking deletion:', notificationError)
    }

    res.sendSuccess(
      { waitlistProcessed: waitlistResults.length, convertedWaitlists: waitlistResults },
      '预约取消成功'
    )
  } catch (error) {
    next(error)
  }
}
