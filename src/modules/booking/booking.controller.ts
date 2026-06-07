import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  bookingSchema,
  bookingUpdateSchema,
  bookingQuerySchema,
  idParamSchema,
} from '../../common/schemas'
import {
  validatePlayerCount,
  createBookingWithSessionUpdate,
  updateBookingPlayerCount,
  deleteBookingWithSessionUpdate,
  getOrCreateCustomer,
} from './booking.service'
import { processPendingWaitlists } from '../waitlist/waitlist.service'

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
  Record<string, never>,
  Record<string, never>
>

export const createBooking = async (req: CreateBookingRequest, res: Response, next: NextFunction) => {
  try {
    const { sessionId, customerName, customerPhone, playerCount, status, remark } = req.body

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { script: true },
    })

    if (!session) {
      throw new AppError('场次不存在', 404)
    }

    if (session.status === 'CANCELLED') {
      throw new AppError('场次已取消，无法预约', 400)
    }

    validatePlayerCount(session.currentPlayers, session.maxPlayers, playerCount)

    const booking = await prisma.$transaction(async (tx) => {
      const customer = await getOrCreateCustomer(tx, customerName, customerPhone)

      const newBooking = await createBookingWithSessionUpdate(tx, {
        sessionId,
        customerId: customer.id,
        playerCount,
        status,
        remark,
      })

      return newBooking
    })

    res.sendSuccess(booking, '预约成功')
  } catch (error) {
    next(error)
  }
}

export const getBookingList = async (req: GetBookingListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, sessionId, customerId, status, keyword } = req.query

    const where: Record<string, unknown> = {}
    if (sessionId) where.sessionId = sessionId
    if (customerId) where.customerId = customerId
    if (status) where.status = status
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
            room: { contains: keyword },
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

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            script: true,
            host: { select: { id: true, name: true, phone: true } },
          },
        },
        customer: true,
      },
    })

    if (!booking) {
      throw new AppError('预约记录不存在', 404)
    }

    res.sendSuccess(booking)
  } catch (error) {
    next(error)
  }
}

export const updateBooking = async (req: UpdateBookingRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { status, playerCount, remark } = req.body

    const existingBooking = await prisma.booking.findUnique({
      where: { id },
      include: { session: true },
    })

    if (!existingBooking) {
      throw new AppError('预约记录不存在', 404)
    }

    const playerCountChanged = playerCount !== undefined && playerCount !== existingBooking.playerCount
    const playerCountDecreased = playerCountChanged && playerCount! < existingBooking.playerCount
    const statusChangedToCancelled = status === 'CANCELLED' && existingBooking.status !== 'CANCELLED'
    const statusChangedFromCancelled = status !== undefined && status !== 'CANCELLED' && existingBooking.status === 'CANCELLED'
    const shouldProcessWaitlist = playerCountDecreased || statusChangedToCancelled
    const bookingWasActive = existingBooking.status !== 'CANCELLED'

    const booking = await prisma.$transaction(async (tx) => {
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
            },
          },
          customer: { select: { id: true, name: true, phone: true } },
        },
      })

      return updatedBooking
    })

    let waitlistResults: Array<{ waitlistId: number; bookingId: number; message: string }> = []
    if (shouldProcessWaitlist) {
      waitlistResults = await processPendingWaitlists(existingBooking.sessionId)
    }

    res.sendSuccess(
      { booking, waitlistProcessed: waitlistResults.length, convertedWaitlists: waitlistResults },
      '预约更新成功'
    )
  } catch (error) {
    next(error)
  }
}

export const deleteBooking = async (req: GetBookingByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingBooking = await prisma.booking.findUnique({
      where: { id },
    })

    if (!existingBooking) {
      throw new AppError('预约记录不存在', 404)
    }

    await prisma.$transaction(async (tx) => {
      await deleteBookingWithSessionUpdate(
        tx,
        existingBooking.id,
        existingBooking.sessionId,
        existingBooking.playerCount
      )
    })

    const waitlistResults = await processPendingWaitlists(existingBooking.sessionId)

    res.sendSuccess(
      { waitlistProcessed: waitlistResults.length, convertedWaitlists: waitlistResults },
      '预约取消成功'
    )
  } catch (error) {
    next(error)
  }
}
