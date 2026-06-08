import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { WaitlistStatus, BookingStatus, Prisma } from '@prisma/client'
import {
  validatePlayerCount,
  createBookingWithSessionUpdate,
  getOrCreateCustomer,
} from '../booking/booking.service'
import { tryCreateNotificationForEvent } from '../notification/notification.service'
import { WaitlistConfirmedParams } from '../notification/types'

export interface WaitlistCreateData {
  storeId?: number
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
  const { storeId, sessionId, customerName, customerPhone, playerCount, remark } = data

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
    throw new AppError('场次已取消，无法候补', 400)
  }

  if (session.currentPlayers + playerCount <= session.maxPlayers) {
    throw new AppError('场次仍有余位，请直接预约', 400)
  }

  const customer = await prisma.$transaction(async (tx) => {
    return await getOrCreateCustomer(tx, customerName, customerPhone)
  })

  const waitlist = await prisma.waitlist.create({
    data: {
      sessionId,
      customerId: customer.id,
      playerCount,
      remark,
    },
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

  return waitlist
}

const confirmWaitlistToBookingInternal = async (
  tx: Prisma.TransactionClient,
  waitlistId: number,
  status: BookingStatus = BookingStatus.PENDING,
  remark?: string,
  storeId?: number
): Promise<WaitlistConfirmResult> => {
  const waitlist = await tx.waitlist.findUnique({
    where: { id: waitlistId },
    include: {
      session: {
        include: {
          store: true,
        },
      },
      customer: true,
    },
  })

  if (!waitlist) {
    throw new AppError('候补记录不存在', 404)
  }

  if (storeId !== undefined && waitlist.session.storeId !== storeId) {
    throw new AppError('候补不属于该门店', 404)
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

  if (waitlist.session.status === 'COMPLETED') {
    await tx.waitlist.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.EXPIRED },
    })
    return { success: false, message: '场次已完成，候补已过期' }
  }

  const session = await tx.session.findUnique({
    where: { id: waitlist.sessionId },
  })

  if (!session) {
    throw new AppError('场次不存在', 404)
  }

  const hasActiveBooking = await tx.booking.findFirst({
    where: {
      customerId: waitlist.customerId,
      sessionId: waitlist.sessionId,
      status: {
        notIn: [BookingStatus.CANCELLED],
      },
    },
  })
  if (hasActiveBooking) {
    await tx.waitlist.update({
      where: { id: waitlistId },
      data: { status: WaitlistStatus.CANCELLED, remark: '顾客已存在有效预约，候补自动取消' },
    })
    return { success: false, message: '顾客已存在同场次有效预约，候补已取消' }
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

  const sessionWithDetails = await tx.session.findUnique({
    where: { id: waitlist.sessionId },
    include: { script: true, host: true, room: true, store: true },
  })
  if (!sessionWithDetails) {
    throw new AppError('场次不存在', 404)
  }

  const templateParams: Omit<WaitlistConfirmedParams, 'storeName'> = {
    waitlistId: waitlistId,
    bookingId: booking.id,
    scriptName: sessionWithDetails.script.name,
    hostName: sessionWithDetails.host?.name || '',
    roomName: sessionWithDetails.room?.name || '',
    startTime: sessionWithDetails.startTime.toLocaleString('zh-CN'),
    playerCount: waitlist.playerCount,
  }

  await tryCreateNotificationForEvent(
    { type: 'WAITLIST_CONFIRMED', waitlistId },
    {
      recipient: {
        name: waitlist.customer.name ?? '',
        phone: waitlist.customer.phone,
      },
      templateParams,
      storeId: sessionWithDetails.storeId,
      relatedBookingId: booking.id,
      relatedSessionId: waitlist.sessionId,
      relatedCustomerId: waitlist.customerId,
    },
    tx
  )

  return { success: true, bookingId: booking.id, message: '候补转正成功' }
}

export const confirmWaitlistToBooking = async (
  waitlistId: number,
  status: BookingStatus = BookingStatus.PENDING,
  remark?: string,
  storeId?: number
): Promise<WaitlistConfirmResult> => {
  return await prisma.$transaction(async (tx) => {
    return await confirmWaitlistToBookingInternal(tx, waitlistId, status, remark, storeId)
  })
}

export interface WaitlistProcessResult {
  waitlistId: number
  bookingId?: number
  success: boolean
  message: string
  skippedReason?: string
}

export const processPendingWaitlists = async (
  sessionId: number
): Promise<WaitlistProcessResult[]> => {
  const results: WaitlistProcessResult[] = []

  await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      results.push({
        waitlistId: 0,
        success: false,
        message: '场次不存在',
        skippedReason: 'SESSION_NOT_FOUND',
      })
      return
    }

    if (session.status === 'CANCELLED') {
      results.push({
        waitlistId: 0,
        success: false,
        message: '场次已取消，无需处理候补',
        skippedReason: 'SESSION_CANCELLED',
      })
      return
    }

    if (session.status === 'COMPLETED') {
      results.push({
        waitlistId: 0,
        success: false,
        message: '场次已完成，无需处理候补',
        skippedReason: 'SESSION_COMPLETED',
      })
      return
    }

    const pendingWaitlists = await tx.waitlist.findMany({
      where: {
        sessionId,
        status: WaitlistStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
    })

    if (pendingWaitlists.length === 0) {
      results.push({
        waitlistId: 0,
        success: false,
        message: '没有待处理的候补记录',
        skippedReason: 'NO_PENDING_WAITLISTS',
      })
      return
    }

    for (const waitlist of pendingWaitlists) {
      const currentSession = await tx.session.findUnique({
        where: { id: sessionId },
      })
      if (!currentSession) {
        results.push({
          waitlistId: waitlist.id,
          success: false,
          message: '场次不存在',
          skippedReason: 'SESSION_NOT_FOUND',
        })
        break
      }

      if (currentSession.status === 'CANCELLED' || currentSession.status === 'COMPLETED') {
        results.push({
          waitlistId: waitlist.id,
          success: false,
          message: '场次已取消或已完成',
          skippedReason: 'SESSION_ENDED',
        })
        break
      }

      const remainingSlots = currentSession.maxPlayers - currentSession.currentPlayers
      if (remainingSlots <= 0) {
        results.push({
          waitlistId: waitlist.id,
          success: false,
          message: '场次已满，无剩余座位',
          skippedReason: 'NO_REMAINING_SLOTS',
        })
        break
      }

      if (waitlist.playerCount > remainingSlots) {
        results.push({
          waitlistId: waitlist.id,
          success: false,
          message: `候补人数 ${waitlist.playerCount} 超过剩余座位 ${remainingSlots}，跳过`,
          skippedReason: 'INSUFFICIENT_SLOTS',
        })
        continue
      }

      const result = await confirmWaitlistToBookingInternal(tx, waitlist.id)
      if (result.success && result.bookingId) {
        results.push({
          waitlistId: waitlist.id,
          bookingId: result.bookingId,
          success: true,
          message: result.message,
        })
      } else {
        results.push({
          waitlistId: waitlist.id,
          success: false,
          message: result.message,
          skippedReason: 'CONFIRMATION_FAILED',
        })
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
  },
  storeId?: number
) => {
  const existing = await prisma.waitlist.findUnique({
    where: { id },
    include: {
      session: {
        include: {
          store: true,
        },
      },
    },
  })

  if (!existing) {
    throw new AppError('候补记录不存在', 404)
  }

  if (storeId !== undefined && existing.session.storeId !== storeId) {
    throw new AppError('候补不属于该门店', 404)
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
          store: { select: { id: true, name: true } },
        },
      },
      customer: { select: { id: true, name: true, phone: true } },
    },
  })

  return waitlist
}

export const getWaitlistById = async (id: number, storeId?: number) => {
  const waitlist = await prisma.waitlist.findUnique({
    where: { id },
    include: {
      session: {
        include: {
          script: true,
          host: { select: { id: true, name: true, phone: true } },
          room: { select: { id: true, name: true } },
          store: { select: { id: true, name: true } },
        },
      },
      customer: true,
    },
  })

  if (!waitlist) {
    throw new AppError('候补记录不存在', 404)
  }

  if (storeId !== undefined && waitlist.session.storeId !== storeId) {
    throw new AppError('候补不属于该门店', 404)
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
    storeId?: number
    phone?: string
  }
) => {
  const where: Record<string, unknown> = {}
  if (filters?.sessionId) where.sessionId = filters.sessionId
  if (filters?.customerId) where.customerId = filters.customerId
  if (filters?.status) where.status = filters.status
  if (filters?.storeId) where.session = { storeId: filters.storeId }
  if (filters?.phone) {
    where.customer = { phone: { contains: filters.phone } }
  }
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
            room: { select: { id: true, name: true } },
            store: { select: { id: true, name: true } },
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

export const deleteWaitlist = async (id: number, storeId?: number) => {
  const existing = await prisma.waitlist.findUnique({
    where: { id },
    include: { session: { include: { store: true } } },
  })
  if (!existing) {
    throw new AppError('候补记录不存在', 404)
  }
  if (storeId !== undefined && existing.session.storeId !== storeId) {
    throw new AppError('候补不属于该门店', 404)
  }
  await prisma.waitlist.delete({ where: { id } })
}
