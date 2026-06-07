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
    const { sessionId, customerName, customerPhone, playerCount } = req.body

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

    if (session.currentPlayers + playerCount > session.maxPlayers) {
      throw new AppError(
        `场次剩余 ${session.maxPlayers - session.currentPlayers} 个位置，无法预约 ${playerCount} 人`,
        400
      )
    }

    let customer = await prisma.customer.findUnique({
      where: { phone: customerPhone },
    })

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: customerName,
          phone: customerPhone,
        },
      })
    }

    const booking = await prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          sessionId,
          customerId: customer.id,
          playerCount,
          status: req.body.status,
          remark: req.body.remark,
        },
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

      await tx.session.update({
        where: { id: sessionId },
        data: {
          currentPlayers: {
            increment: playerCount,
          },
        },
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

    const booking = await prisma.$transaction(async (tx) => {
      if (playerCount !== undefined && playerCount !== existingBooking.playerCount) {
        const diff = playerCount - existingBooking.playerCount
        const newCurrentPlayers = existingBooking.session.currentPlayers + diff

        if (newCurrentPlayers > existingBooking.session.maxPlayers) {
          throw new AppError('人数超出场次最大限制', 400)
        }
        if (newCurrentPlayers < 0) {
          throw new AppError('人数不能为负数', 400)
        }

        await tx.session.update({
          where: { id: existingBooking.sessionId },
          data: {
            currentPlayers: newCurrentPlayers,
          },
        })
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

    res.sendSuccess(booking, '预约更新成功')
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
      await tx.booking.delete({
        where: { id },
      })

      await tx.session.update({
        where: { id: existingBooking.sessionId },
        data: {
          currentPlayers: {
            decrement: existingBooking.playerCount,
          },
        },
      })
    })

    res.sendSuccess(null, '预约取消成功')
  } catch (error) {
    next(error)
  }
}
