import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { Booking, BookingStatus, Prisma, MembershipAccount } from '@prisma/client'

export interface MembershipAccountInfo {
  id: number
  balance: Prisma.Decimal
  isActive: boolean
}

export const getActiveMembershipAccount = (
  customer: { membershipAccount?: MembershipAccount | null }
): MembershipAccountInfo | null => {
  const account = customer.membershipAccount
  if (account && account.isActive) {
    return {
      id: account.id,
      balance: account.balance,
      isActive: account.isActive,
    }
  }
  return null
}

export const customerWithMembershipSelect = {
  id: true,
  name: true,
  phone: true,
  membershipAccount: {
    select: {
      id: true,
      balance: true,
      isActive: true,
    },
  },
}

export interface BookingCreateData {
  sessionId: number
  customerId: number
  playerCount: number
  status?: BookingStatus
  remark?: string
}

export const validatePlayerCount = (
  currentPlayers: number,
  maxPlayers: number,
  playerCount: number,
  existingCount: number = 0
): void => {
  const newCurrentPlayers = currentPlayers - existingCount + playerCount
  if (newCurrentPlayers > maxPlayers) {
    throw new AppError(
      `场次剩余 ${maxPlayers - currentPlayers + existingCount} 个位置，无法预约 ${playerCount} 人`,
      400
    )
  }
  if (newCurrentPlayers < 0) {
    throw new AppError('人数不能为负数', 400)
  }
}

export const createBookingWithSessionUpdate = async (
  tx: Prisma.TransactionClient,
  data: BookingCreateData
) => {
  const booking = await tx.booking.create({
    data: {
      sessionId: data.sessionId,
      customerId: data.customerId,
      playerCount: data.playerCount,
      status: data.status,
      remark: data.remark,
    },
    include: {
      session: {
        include: {
          script: { select: { id: true, name: true } },
          host: { select: { id: true, name: true } },
        },
      },
      customer: { select: customerWithMembershipSelect },
    },
  })

  await tx.session.update({
    where: { id: data.sessionId },
    data: {
      currentPlayers: {
        increment: data.playerCount,
      },
    },
  })

  return booking
}

export const updateBookingPlayerCount = async (
  tx: Prisma.TransactionClient,
  sessionId: number,
  oldPlayerCount: number,
  newPlayerCount: number
): Promise<void> => {
  const diff = newPlayerCount - oldPlayerCount
  const session = await tx.session.findUnique({ where: { id: sessionId } })
  if (!session) {
    throw new AppError('场次不存在', 404)
  }
  const newCurrentPlayers = session.currentPlayers + diff
  if (newCurrentPlayers > session.maxPlayers) {
    throw new AppError('人数超出场次最大限制', 400)
  }
  if (newCurrentPlayers < 0) {
    throw new AppError('人数不能为负数', 400)
  }
  await tx.session.update({
    where: { id: sessionId },
    data: { currentPlayers: newCurrentPlayers },
  })
}

export const deleteBookingWithSessionUpdate = async (
  tx: Prisma.TransactionClient,
  bookingId: number,
  sessionId: number,
  playerCount: number
): Promise<void> => {
  await tx.booking.delete({ where: { id: bookingId } })
  await tx.session.update({
    where: { id: sessionId },
    data: {
      currentPlayers: {
        decrement: playerCount,
      },
    },
  })
}

export const getOrCreateCustomer = async (
  tx: Prisma.TransactionClient,
  name: string,
  phone: string
) => {
  let customer = await tx.customer.findUnique({ where: { phone } })
  if (!customer) {
    customer = await tx.customer.create({ data: { name, phone } })
  }
  return customer
}
