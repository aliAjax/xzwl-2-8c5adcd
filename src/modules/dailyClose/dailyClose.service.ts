import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { Prisma, SessionStatus, BookingStatus, MembershipTransactionType, MembershipTransactionStatus, StoreDailyCloseStatus } from '@prisma/client'
import dayjs from 'dayjs'

export interface DailyCloseCreateData {
  storeId: number
  businessDate: Date
  operator?: string
  remark?: string
}

export interface DailyCloseVoidData {
  operator?: string
  remark?: string
}

const getDateRange = (date: Date) => {
  const startOfDay = dayjs(date).startOf('day').toDate()
  const endOfDay = dayjs(date).endOf('day').toDate()
  return { startOfDay, endOfDay }
}

const getCompletedSessions = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  startOfDay: Date,
  endOfDay: Date
) => {
  return tx.session.findMany({
    where: {
      storeId,
      status: SessionStatus.COMPLETED,
      startTime: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    include: {
      script: { select: { name: true } },
      host: { select: { name: true } },
      room: { select: { name: true } },
      bookings: {
        where: {
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.PENDING],
          },
        },
        include: {
          customer: { select: { name: true, phone: true } },
        },
      },
    },
    orderBy: { startTime: 'asc' },
  })
}

const getMembershipTransactions = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  startOfDay: Date,
  endOfDay: Date
) => {
  return tx.membershipTransaction.findMany({
    where: {
      status: MembershipTransactionStatus.SUCCESS,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      OR: [
        {
          relatedBooking: {
            session: { storeId },
          },
        },
        {
          relatedBookingId: null,
          account: {
            customer: {
              bookings: {
                some: {
                  session: {
                    storeId,
                    startTime: {
                      gte: startOfDay,
                      lte: endOfDay,
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
    include: {
      account: {
        include: {
          customer: { select: { name: true, phone: true } },
        },
      },
      relatedBooking: {
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export const calculateDailyCloseData = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  businessDate: Date
) => {
  const { startOfDay, endOfDay } = getDateRange(businessDate)

  const [sessions, transactions] = await Promise.all([
    getCompletedSessions(tx, storeId, startOfDay, endOfDay),
    getMembershipTransactions(tx, storeId, startOfDay, endOfDay),
  ])

  const completedSessionCount = sessions.length
  let totalBookingCount = 0
  let totalPlayerCount = 0
  let receivableAmount = new Prisma.Decimal(0)

  const sessionSnapshots: Prisma.StoreDailyCloseSessionCreateManyDailyCloseInput[] = []
  const bookingSnapshots: Prisma.StoreDailyCloseBookingCreateManyDailyCloseInput[] = []

  for (const session of sessions) {
    const sessionPlayerCount = session.bookings.reduce((sum, b) => sum + b.playerCount, 0)
    const sessionBookingCount = session.bookings.length
    const sessionAmount = session.price.times(sessionPlayerCount)

    totalBookingCount += sessionBookingCount
    totalPlayerCount += sessionPlayerCount
    receivableAmount = receivableAmount.plus(sessionAmount)

    sessionSnapshots.push({
      sessionId: session.id,
      scriptName: session.script.name,
      hostName: session.host.name,
      roomName: session.room.name,
      startTime: session.startTime,
      endTime: session.endTime,
      price: session.price,
      playerCount: sessionPlayerCount,
      bookingCount: sessionBookingCount,
      sessionAmount: sessionAmount,
    })

    for (const booking of session.bookings) {
      const bookingAmount = session.price.times(booking.playerCount)
      const membershipTx = transactions.find(
        t => t.relatedBookingId === booking.id && t.type === MembershipTransactionType.CONSUME
      )

      bookingSnapshots.push({
        bookingId: booking.id,
        sessionId: session.id,
        customerName: booking.customer.name,
        customerPhone: booking.customer.phone,
        playerCount: booking.playerCount,
        sessionPrice: session.price,
        bookingAmount: bookingAmount,
        useMembership: !!membershipTx,
        membershipAmount: membershipTx?.amount || new Prisma.Decimal(0),
      })
    }
  }

  let membershipConsume = new Prisma.Decimal(0)
  let membershipRecharge = new Prisma.Decimal(0)
  let refundAmount = new Prisma.Decimal(0)

  const transactionSnapshots: Prisma.StoreDailyCloseTransactionCreateManyDailyCloseInput[] = []

  for (const txn of transactions) {
    if (txn.type === MembershipTransactionType.CONSUME) {
      membershipConsume = membershipConsume.plus(txn.amount)
    } else if (txn.type === MembershipTransactionType.RECHARGE) {
      membershipRecharge = membershipRecharge.plus(txn.amount)
    } else if (txn.type === MembershipTransactionType.REFUND) {
      refundAmount = refundAmount.plus(txn.amount)
    }

    transactionSnapshots.push({
      transactionId: txn.id,
      customerName: txn.account.customer.name,
      customerPhone: txn.account.customer.phone,
      type: txn.type,
      amount: txn.amount,
      balanceAfter: txn.balanceAfter,
      status: txn.status,
      remark: txn.remark,
      operator: txn.operator,
      relatedBookingId: txn.relatedBookingId,
      transactionCreatedAt: txn.createdAt,
    })
  }

  const discrepancyAmount = receivableAmount.minus(membershipConsume)

  return {
    summary: {
      completedSessionCount,
      totalBookingCount,
      totalPlayerCount,
      receivableAmount,
      membershipConsume,
      membershipRecharge,
      refundAmount,
      discrepancyAmount,
    },
    sessionSnapshots,
    bookingSnapshots,
    transactionSnapshots,
  }
}

export const createDailyClose = async (data: DailyCloseCreateData) => {
  const { storeId, businessDate, operator, remark } = data

  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) {
    throw new AppError('门店不存在', 404)
  }

  const { startOfDay } = getDateRange(businessDate)
  const normalizedDate = startOfDay

  const existingNormal = await prisma.storeDailyClose.findFirst({
    where: {
      storeId,
      businessDate: normalizedDate,
      status: StoreDailyCloseStatus.NORMAL,
    },
  })

  if (existingNormal) {
    throw new AppError('该门店该营业日期已存在有效的日结单', 400)
  }

  return prisma.$transaction(async tx => {
    const { summary, sessionSnapshots, bookingSnapshots, transactionSnapshots } =
      await calculateDailyCloseData(tx, storeId, normalizedDate)

    const dailyClose = await tx.storeDailyClose.create({
      data: {
        storeId,
        businessDate: normalizedDate,
        status: StoreDailyCloseStatus.NORMAL,
        ...summary,
        operator,
        remark,
        sessionSnapshots: {
          createMany: {
            data: sessionSnapshots,
          },
        },
        bookingSnapshots: {
          createMany: {
            data: bookingSnapshots,
          },
        },
        transactionSnapshots: {
          createMany: {
            data: transactionSnapshots,
          },
        },
      },
      include: {
        store: { select: { id: true, name: true } },
      },
    })

    return dailyClose
  })
}

export const getDailyCloseList = async (query: {
  page: number
  pageSize: number
  storeId?: number
  status?: StoreDailyCloseStatus
  startDate?: Date
  endDate?: Date
}) => {
  const { page, pageSize, storeId, status, startDate, endDate } = query

  const where: Prisma.StoreDailyCloseWhereInput = {}
  if (storeId !== undefined) where.storeId = storeId
  if (status) where.status = status
  if (startDate || endDate) {
    where.businessDate = {}
    if (startDate) where.businessDate.gte = dayjs(startDate).startOf('day').toDate()
    if (endDate) where.businessDate.lte = dayjs(endDate).endOf('day').toDate()
  }

  const [list, total] = await Promise.all([
    prisma.storeDailyClose.findMany({
      where,
      include: {
        store: { select: { id: true, name: true } },
        originalClose: { select: { id: true, createdAt: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { businessDate: 'desc' },
    }),
    prisma.storeDailyClose.count({ where }),
  ])

  return { list, total }
}

export const getDailyCloseDetail = async (id: number) => {
  const dailyClose = await prisma.storeDailyClose.findUnique({
    where: { id },
    include: {
      store: { select: { id: true, name: true } },
      originalClose: { select: { id: true, createdAt: true, operator: true } },
      sessionSnapshots: {
        orderBy: { startTime: 'asc' },
      },
      bookingSnapshots: {
        orderBy: { createdAt: 'asc' },
      },
      transactionSnapshots: {
        orderBy: { transactionCreatedAt: 'asc' },
      },
    },
  })

  if (!dailyClose) {
    throw new AppError('日结单不存在', 404)
  }

  return dailyClose
}

export const voidAndRecreateDailyClose = async (id: number, data: DailyCloseVoidData) => {
  const existingClose = await prisma.storeDailyClose.findUnique({
    where: { id },
    include: {
      sessionSnapshots: true,
      bookingSnapshots: true,
      transactionSnapshots: true,
    },
  })

  if (!existingClose) {
    throw new AppError('日结单不存在', 404)
  }

  if (existingClose.status === StoreDailyCloseStatus.VOIDED) {
    throw new AppError('该日结单已作废，无法重复作废', 400)
  }

  return prisma.$transaction(async tx => {
    await tx.storeDailyClose.update({
      where: { id },
      data: {
        status: StoreDailyCloseStatus.VOIDED,
      },
    })

    const { summary, sessionSnapshots, bookingSnapshots, transactionSnapshots } =
      await calculateDailyCloseData(tx, existingClose.storeId, existingClose.businessDate)

    const newClose = await tx.storeDailyClose.create({
      data: {
        storeId: existingClose.storeId,
        businessDate: existingClose.businessDate,
        status: StoreDailyCloseStatus.NORMAL,
        ...summary,
        operator: data.operator,
        remark: data.remark,
        originalCloseId: existingClose.id,
        sessionSnapshots: {
          createMany: {
            data: sessionSnapshots,
          },
        },
        bookingSnapshots: {
          createMany: {
            data: bookingSnapshots,
          },
        },
        transactionSnapshots: {
          createMany: {
            data: transactionSnapshots,
          },
        },
      },
      include: {
        store: { select: { id: true, name: true } },
        originalClose: { select: { id: true, createdAt: true, operator: true } },
      },
    })

    return {
      voidedClose: { id: existingClose.id, status: StoreDailyCloseStatus.VOIDED },
      newClose,
    }
  })
}

export const getDailyCloseByStoreAndDate = async (storeId: number, businessDate: Date) => {
  const { startOfDay } = getDateRange(businessDate)
  return prisma.storeDailyClose.findFirst({
    where: {
      storeId,
      businessDate: startOfDay,
      status: StoreDailyCloseStatus.NORMAL,
    },
  })
}

export interface DailyCloseSummaryItem {
  date: string
  status: 'CLOSED' | 'UNOFFICIAL'
  closeStatus?: StoreDailyCloseStatus
  bookingIncome: Prisma.Decimal
  membershipRecharge: Prisma.Decimal
  membershipConsume: Prisma.Decimal
  refundAmount: Prisma.Decimal
  operator?: string | null
}

export const getDailyCloseSummary = async (query: {
  storeId: number
  startDate: Date
  endDate: Date
}): Promise<DailyCloseSummaryItem[]> => {
  const { storeId, startDate, endDate } = query

  const start = dayjs(startDate).startOf('day')
  const end = dayjs(endDate).endOf('day')

  const days: string[] = []
  let current = start.clone()
  while (current.isBefore(end) || current.isSame(end, 'day')) {
    days.push(current.format('YYYY-MM-DD'))
    current = current.add(1, 'day')
  }

  const startOfRange = start.toDate()
  const endOfRange = end.toDate()

  const [dailyCloses, transactions, sessions] = await Promise.all([
    prisma.storeDailyClose.findMany({
      where: {
        storeId,
        businessDate: {
          gte: startOfRange,
          lte: endOfRange,
        },
        status: StoreDailyCloseStatus.NORMAL,
      },
      select: {
        businessDate: true,
        status: true,
        receivableAmount: true,
        membershipRecharge: true,
        membershipConsume: true,
        refundAmount: true,
        operator: true,
      },
    }),
    prisma.membershipTransaction.findMany({
      where: {
        storeId,
        status: MembershipTransactionStatus.SUCCESS,
        createdAt: {
          gte: startOfRange,
          lte: endOfRange,
        },
      },
      select: {
        createdAt: true,
        type: true,
        amount: true,
      },
    }),
    prisma.session.findMany({
      where: {
        storeId,
        status: SessionStatus.COMPLETED,
        startTime: {
          gte: startOfRange,
          lte: endOfRange,
        },
      },
      select: {
        startTime: true,
        price: true,
        bookings: {
          where: {
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
          },
          select: { playerCount: true },
        },
      },
    }),
  ])

  const closeMap = new Map<string, typeof dailyCloses[0]>()
  for (const close of dailyCloses) {
    const dateKey = dayjs(close.businessDate).format('YYYY-MM-DD')
    closeMap.set(dateKey, close)
  }

  const txMap = new Map<string, { recharge: Prisma.Decimal; consume: Prisma.Decimal; refund: Prisma.Decimal }>()
  for (const tx of transactions) {
    const dateKey = dayjs(tx.createdAt).format('YYYY-MM-DD')
    if (!txMap.has(dateKey)) {
      txMap.set(dateKey, {
        recharge: new Prisma.Decimal(0),
        consume: new Prisma.Decimal(0),
        refund: new Prisma.Decimal(0),
      })
    }
    const dayTx = txMap.get(dateKey)!
    if (tx.type === MembershipTransactionType.RECHARGE) {
      dayTx.recharge = dayTx.recharge.plus(tx.amount)
    } else if (tx.type === MembershipTransactionType.CONSUME) {
      dayTx.consume = dayTx.consume.plus(tx.amount)
    } else if (tx.type === MembershipTransactionType.REFUND) {
      dayTx.refund = dayTx.refund.plus(tx.amount)
    }
  }

  const sessionMap = new Map<string, Prisma.Decimal>()
  for (const session of sessions) {
    const dateKey = dayjs(session.startTime).format('YYYY-MM-DD')
    const playerCount = session.bookings.reduce((sum, b) => sum + b.playerCount, 0)
    const sessionAmount = session.price.times(playerCount)
    if (!sessionMap.has(dateKey)) {
      sessionMap.set(dateKey, new Prisma.Decimal(0))
    }
    sessionMap.set(dateKey, sessionMap.get(dateKey)!.plus(sessionAmount))
  }

  const result: DailyCloseSummaryItem[] = []
  for (const dateKey of days) {
    const close = closeMap.get(dateKey)
    const tx = txMap.get(dateKey)
    const sessionAmount = sessionMap.get(dateKey) || new Prisma.Decimal(0)

    if (close) {
      result.push({
        date: dateKey,
        status: 'CLOSED',
        closeStatus: close.status,
        bookingIncome: close.receivableAmount,
        membershipRecharge: close.membershipRecharge,
        membershipConsume: close.membershipConsume,
        refundAmount: close.refundAmount,
        operator: close.operator,
      })
    } else {
      result.push({
        date: dateKey,
        status: 'UNOFFICIAL',
        bookingIncome: sessionAmount,
        membershipRecharge: tx?.recharge || new Prisma.Decimal(0),
        membershipConsume: tx?.consume || new Prisma.Decimal(0),
        refundAmount: tx?.refund || new Prisma.Decimal(0),
        operator: null,
      })
    }
  }

  return result
}
