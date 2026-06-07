import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { WaitlistStatus, BookingStatus, Prisma } from '@prisma/client'
import {
  validatePlayerCount,
  createBookingWithSessionUpdate,
  getOrCreateCustomer,
} from '../booking/booking.service'

export interface WaitlistCreateData {
  sessionId: number
  customerName: string
  customerPhone: string
  playerCount: number
  remark?: string
}

export interface WaitlistConfirmResult {
  success: boolean
  bookingId?: number
  message: string
}

export const createWaitlist = async (data: WaitlistCreateData) => {
  const session = await prisma.session.findUnique({
    where: { id: data.sessionId },
    include: { script: true },
  })

  if (!session) {
    throw new AppError('场次不存在', 404)
  }

  if (session.status === 'CANCELLED') {
    throw new AppError('场次已取消，无法候补', 400)
  }

  if (session.currentPlayers + data.playerCount <= session.maxPlayers) {
    throw new AppError('场次仍有余位，请直接预约', 400)
  }

  const customer = await prisma.$transaction(async (tx) => {
    return await getOrCreateCustomer(tx, data.customerName, data.customerPhone)
  })

  const waitlist = await prisma.waitlist.create({
    data: {
      sessionId: data.sessionId,
      customerId: customer.id,
      playerCount: data.playerCount,
      remark: data.remark,
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

  return waitlist
}

const confirmWaitlistToBookingInternal = async (
  tx: Prisma.TransactionClient,
  waitlistId: number,
  status: BookingStatus = BookingStatus.PENDING,
  remark?: string
): Promise<WaitlistConfirmResult> => {
  const waitlist = await tx.waitlist.findUnique({
    where: { id: waitlistId },
    include: { session: true },
  })

  if (!waitlist) {
    throw new AppError('候补记录不存在', 404)
  }

  if (waitlist.status !== WaitlistStatus.PENDING) {
    throw new AppError(`候补状态为 ${waitlist.status}，无法转正`, 400)
  }

  if (waitlist.session.status === 'CANCELLED') {
    await tx.waitlist.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.EXPIRED },
    })
    return { success: false, message: '场次已取消，候补已过期' }
  }

  const session = await tx.session.findUnique({
    where: { id: waitlist.sessionId },
  })

  if (!session) {
    throw new AppError('场次不存在', 404)
  }

  validatePlayerCount(session.currentPlayers, session.maxPlayers, waitlist.playerCount)

  const currentSession = await tx.session.findUnique({
    where: { id: waitlist.sessionId },
  })

  if (!currentSession) {
    throw new AppError('场次不存在', 404)
  }

  if (currentSession.currentPlayers + waitlist.playerCount > currentSession.maxPlayers) {
    return { success: false, message: '场次位置不足，无法转正' }
  }

  await tx.waitlist.update({
    where: { id: waitlistId },
    data: { status: WaitlistStatus.CONFIRMED },
  })

  const booking = await createBookingWithSessionUpdate(tx, {
    sessionId: waitlist.sessionId,
    customerId: waitlist.customerId,
    playerCount: waitlist.playerCount,
    status,
    remark: remark ?? waitlist.remark ?? undefined,
  })

  return { success: true, bookingId: booking.id, message: '候补转正成功' }
}

export const confirmWaitlistToBooking = async (
  waitlistId: number,
  status: BookingStatus = BookingStatus.PENDING,
  remark?: string
): Promise<WaitlistConfirmResult> => {
  return await prisma.$transaction(async (tx) => {
    return await confirmWaitlistToBookingInternal(tx, waitlistId, status, remark)
  })
}

export const processPendingWaitlists = async (
  sessionId: number
): Promise<Array<{ waitlistId: number; bookingId: number; message: string }>> => {
  const results: Array<{ waitlistId: number; bookingId: number; message: string }> = []

  await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return
    }

    const pendingWaitlists = await tx.waitlist.findMany({
      where: {
        sessionId,
        status: WaitlistStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
    })

    let remainingSlots = session.maxPlayers - session.currentPlayers

    for (const waitlist of pendingWaitlists) {
      if (remainingSlots <= 0) {
        break
      }

      if (waitlist.playerCount <= remainingSlots) {
        try {
          const result = await confirmWaitlistToBookingInternal(tx, waitlist.id)
          if (result.success && result.bookingId) {
            results.push({
              waitlistId: waitlist.id,
              bookingId: result.bookingId,
              message: result.message,
            })
            remainingSlots -= waitlist.playerCount
          }
        } catch (error) {
          continue
        }
      }
    }
  })

  return results
}

export const updateWaitlist = async (
  id: number,
  data: {
    playerCount?: number
    status?: WaitlistStatus
    remark?: string
  }
) => {
  const existing = await prisma.waitlist.findUnique({
    where: { id },
    include: { session: true },
  })

  if (!existing) {
    throw new AppError('候补记录不存在', 404)
  }

  if (data.playerCount !== undefined && data.playerCount !== existing.playerCount) {
    if (existing.status === WaitlistStatus.CONFIRMED) {
      throw new AppError('已转正的候补不能修改人数', 400)
    }
  }

  const waitlist = await prisma.waitlist.update({
    where: { id },
    data,
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

  return waitlist
}

export const getWaitlistById = async (id: number) => {
  const waitlist = await prisma.waitlist.findUnique({
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

  if (!waitlist) {
    throw new AppError('候补记录不存在', 404)
  }

  return waitlist
}

export const getWaitlistList = async (
  page: number,
  pageSize: number,
  filters?: {
    sessionId?: number
    customerId?: number
    status?: WaitlistStatus
    keyword?: string
  }
) => {
  const where: Record<string, unknown> = {}
  if (filters?.sessionId) where.sessionId = filters.sessionId
  if (filters?.customerId) where.customerId = filters.customerId
  if (filters?.status) where.status = filters.status
  if (filters?.keyword) {
    where.OR = [
      { customer: { name: { contains: filters.keyword } } },
      { customer: { phone: { contains: filters.keyword } } },
    ]
  }

  const [waitlists, total] = await Promise.all([
    prisma.waitlist.findMany({
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
    prisma.waitlist.count({ where }),
  ])

  return { waitlists, total }
}

export const deleteWaitlist = async (id: number) => {
  const existing = await prisma.waitlist.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError('候补记录不存在', 404)
  }
  await prisma.waitlist.delete({ where: { id } })
}
