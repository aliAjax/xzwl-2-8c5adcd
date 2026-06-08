import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { Prisma, SessionStatus, BookingStatus, MembershipTransactionType, MembershipTransactionStatus, StoreDailyCloseStatus, StoreDailyClose, StoreDailyCloseBooking, StoreDailyCloseSession, StoreDailyCloseTransaction } from '@prisma/client'
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

export interface DailyCloseDiffData {
  storeId: number
  businessDate: Date
}

export interface DailyCloseRecloseData {
  storeId: number
  businessDate: Date
  operator?: string
  remark?: string
}

export type DiffChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED'

export interface BookingDiffItem {
  changeType: DiffChangeType
  bookingId: number | null
  sessionId: number
  customerName: string
  customerPhone: string
  playerCount: number
  sessionPrice: Prisma.Decimal
  bookingAmount: Prisma.Decimal
  useMembership: boolean
  membershipAmount: Prisma.Decimal
  original?: {
    bookingId: number
    playerCount: number
    bookingAmount: Prisma.Decimal
    useMembership: boolean
    membershipAmount: Prisma.Decimal
  }
}

export interface TransactionDiffItem {
  changeType: DiffChangeType
  transactionId: number | null
  customerName: string
  customerPhone: string
  type: MembershipTransactionType
  amount: Prisma.Decimal
  balanceAfter: Prisma.Decimal
  status: MembershipTransactionStatus
  remark: string | null
  operator: string | null
  relatedBookingId: number | null
  transactionCreatedAt: Date
  original?: {
    transactionId: number
    amount: Prisma.Decimal
    balanceAfter: Prisma.Decimal
    status: MembershipTransactionStatus
  }
}

export interface SessionDiffItem {
  changeType: DiffChangeType
  sessionId: number | null
  scriptName: string
  hostName: string
  roomName: string
  startTime: Date
  endTime: Date
  price: Prisma.Decimal
  playerCount: number
  bookingCount: number
  sessionAmount: Prisma.Decimal
  original?: {
    sessionId: number
    playerCount: number
    bookingCount: number
    sessionAmount: Prisma.Decimal
  }
}

export interface RecloseHistoryItem {
  id: number
  businessDate: Date
  status: StoreDailyCloseStatus
  createdAt: Date
  operator: string | null
  remark: string | null
  originalCloseId: number | null
  completedSessionCount: number
  totalBookingCount: number
  totalPlayerCount: number
  receivableAmount: Prisma.Decimal
  membershipConsume: Prisma.Decimal
  membershipRecharge: Prisma.Decimal
  refundAmount: Prisma.Decimal
  discrepancyAmount: Prisma.Decimal
  recloseSequence: number
}

export interface DailyCloseDiffResult {
  originalClose: {
    id: number
    businessDate: Date
    createdAt: Date
    operator: string | null
    completedSessionCount: number
    totalBookingCount: number
    totalPlayerCount: number
    receivableAmount: Prisma.Decimal
    membershipConsume: Prisma.Decimal
    membershipRecharge: Prisma.Decimal
    refundAmount: Prisma.Decimal
    discrepancyAmount: Prisma.Decimal
    recloseCount: number
  }
  currentData: {
    completedSessionCount: number
    totalBookingCount: number
    totalPlayerCount: number
    receivableAmount: Prisma.Decimal
    membershipConsume: Prisma.Decimal
    membershipRecharge: Prisma.Decimal
    refundAmount: Prisma.Decimal
    discrepancyAmount: Prisma.Decimal
  }
  diff: {
    completedSessionCount: number
    totalBookingCount: number
    totalPlayerCount: number
    receivableAmount: Prisma.Decimal
    membershipConsume: Prisma.Decimal
    membershipRecharge: Prisma.Decimal
    refundAmount: Prisma.Decimal
    discrepancyAmount: Prisma.Decimal
  }
  sessionDiffs: SessionDiffItem[]
  bookingDiffs: BookingDiffItem[]
  transactionDiffs: TransactionDiffItem[]
  hasDifferences: boolean
  recloseHistory: RecloseHistoryItem[]
}

const getDateRange = (date: Date) => {
  const startOfDay = dayjs(date).startOf('day').toDate()
  const endOfDay = dayjs(date).endOf('day').toDate()
  return { startOfDay, endOfDay }
}

const toDecimal = (value: unknown): Prisma.Decimal => {
  if (value instanceof Prisma.Decimal) return value
  return new Prisma.Decimal(String(value))
}

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value
  return new Date(String(value))
}

const getLatestNormalDailyClose = async (
  tx: Prisma.TransactionClient | typeof prisma,
  storeId: number,
  businessDate: Date
) => {
  const { startOfDay } = getDateRange(businessDate)
  return tx.storeDailyClose.findFirst({
    where: {
      storeId,
      businessDate: startOfDay,
      status: StoreDailyCloseStatus.NORMAL,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      sessionSnapshots: true,
      bookingSnapshots: true,
      transactionSnapshots: true,
    },
  })
}

const getRecloseHistory = async (
  tx: Prisma.TransactionClient | typeof prisma,
  storeId: number,
  businessDate: Date
): Promise<RecloseHistoryItem[]> => {
  const { startOfDay } = getDateRange(businessDate)
  const allCloses = await tx.storeDailyClose.findMany({
    where: {
      storeId,
      businessDate: startOfDay,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      businessDate: true,
      status: true,
      createdAt: true,
      operator: true,
      remark: true,
      originalCloseId: true,
      completedSessionCount: true,
      totalBookingCount: true,
      totalPlayerCount: true,
      receivableAmount: true,
      membershipConsume: true,
      membershipRecharge: true,
      refundAmount: true,
      discrepancyAmount: true,
    },
  })

  const history: RecloseHistoryItem[] = []
  const rootClose = allCloses.find(c => c.originalCloseId === null)
  if (!rootClose) {
    return allCloses.map((c, idx) => ({
      ...c,
      recloseSequence: idx + 1,
    }))
  }

  let current: typeof rootClose | undefined = rootClose
  let sequence = 1
  while (current) {
    history.push({
      ...current,
      recloseSequence: sequence++,
    })
    current = allCloses.find(c => c.originalCloseId === current!.id)
  }

  return history
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
        { storeId },
        {
          relatedBooking: {
            session: { storeId },
          },
        },
        {
          relatedBookingId: null,
          storeId: null,
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
        originalClose: { select: { id: true, createdAt: true, operator: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { businessDate: 'desc' },
    }),
    prisma.storeDailyClose.count({ where }),
  ])

  const uniqueDateKeys = new Set<string>()
  const dateKeyToParams = new Map<string, { storeId: number; businessDate: Date }>()

  for (const item of list) {
    const key = `${item.storeId}-${dayjs(item.businessDate).format('YYYY-MM-DD')}`
    if (!uniqueDateKeys.has(key)) {
      uniqueDateKeys.add(key)
      dateKeyToParams.set(key, { storeId: item.storeId, businessDate: item.businessDate })
    }
  }

  const recloseCountMap = new Map<string, number>()
  await Promise.all(
    Array.from(dateKeyToParams.entries()).map(async ([key, params]) => {
      const history = await getRecloseHistory(prisma, params.storeId, params.businessDate)
      recloseCountMap.set(key, history.length - 1)
    })
  )

  const listWithRecloseCount = list.map(item => {
    const key = `${item.storeId}-${dayjs(item.businessDate).format('YYYY-MM-DD')}`
    return {
      ...item,
      recloseCount: recloseCountMap.get(key) || 0,
    }
  })

  return { list: listWithRecloseCount, total }
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

  const recloseHistory = await getRecloseHistory(prisma, dailyClose.storeId, dailyClose.businessDate)

  return {
    ...dailyClose,
    recloseHistory,
    recloseCount: recloseHistory.length - 1,
  }
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

const compareSessions = (
  original: StoreDailyCloseSession[],
  current: Prisma.StoreDailyCloseSessionCreateManyDailyCloseInput[]
): SessionDiffItem[] => {
  const diffs: SessionDiffItem[] = []
  const originalMap = new Map(original.map(s => [s.sessionId, s]))
  const currentMap = new Map(current.map(s => [s.sessionId!, s]))

  for (const [sessionId, orig] of originalMap) {
    const curr = currentMap.get(sessionId)
    if (!curr) {
      diffs.push({
        changeType: 'REMOVED',
        sessionId: orig.sessionId,
        scriptName: orig.scriptName,
        hostName: orig.hostName,
        roomName: orig.roomName,
        startTime: orig.startTime,
        endTime: orig.endTime,
        price: orig.price,
        playerCount: 0,
        bookingCount: 0,
        sessionAmount: new Prisma.Decimal(0),
        original: {
          sessionId: orig.sessionId,
          playerCount: orig.playerCount,
          bookingCount: orig.bookingCount,
          sessionAmount: orig.sessionAmount,
        },
      })
    } else if (
      orig.playerCount !== curr.playerCount ||
      orig.bookingCount !== curr.bookingCount ||
      !orig.sessionAmount.equals(toDecimal(curr.sessionAmount))
    ) {
      diffs.push({
        changeType: 'MODIFIED',
        sessionId: curr.sessionId!,
        scriptName: curr.scriptName,
        hostName: curr.hostName,
        roomName: curr.roomName,
        startTime: toDate(curr.startTime),
        endTime: toDate(curr.endTime),
        price: toDecimal(curr.price),
        playerCount: curr.playerCount!,
        bookingCount: curr.bookingCount!,
        sessionAmount: toDecimal(curr.sessionAmount),
        original: {
          sessionId: orig.sessionId,
          playerCount: orig.playerCount,
          bookingCount: orig.bookingCount,
          sessionAmount: orig.sessionAmount,
        },
      })
    }
  }

  for (const [sessionId, curr] of currentMap) {
    if (!originalMap.has(sessionId)) {
      diffs.push({
        changeType: 'ADDED',
        sessionId: curr.sessionId!,
        scriptName: curr.scriptName,
        hostName: curr.hostName,
        roomName: curr.roomName,
        startTime: toDate(curr.startTime),
        endTime: toDate(curr.endTime),
        price: toDecimal(curr.price),
        playerCount: curr.playerCount!,
        bookingCount: curr.bookingCount!,
        sessionAmount: toDecimal(curr.sessionAmount),
      })
    }
  }

  return diffs.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
}

const compareBookings = (
  original: StoreDailyCloseBooking[],
  current: Prisma.StoreDailyCloseBookingCreateManyDailyCloseInput[]
): BookingDiffItem[] => {
  const diffs: BookingDiffItem[] = []
  const originalMap = new Map(original.map(b => [b.bookingId, b]))
  const currentMap = new Map(current.map(b => [b.bookingId!, b]))

  for (const [bookingId, orig] of originalMap) {
    const curr = currentMap.get(bookingId)
    if (!curr) {
      diffs.push({
        changeType: 'REMOVED',
        bookingId: null,
        sessionId: orig.sessionId,
        customerName: orig.customerName,
        customerPhone: orig.customerPhone,
        playerCount: 0,
        sessionPrice: orig.sessionPrice,
        bookingAmount: new Prisma.Decimal(0),
        useMembership: false,
        membershipAmount: new Prisma.Decimal(0),
        original: {
          bookingId: orig.bookingId,
          playerCount: orig.playerCount,
          bookingAmount: orig.bookingAmount,
          useMembership: orig.useMembership,
          membershipAmount: orig.membershipAmount,
        },
      })
    } else if (
      orig.playerCount !== curr.playerCount ||
      !orig.bookingAmount.equals(toDecimal(curr.bookingAmount)) ||
      orig.useMembership !== curr.useMembership ||
      !orig.membershipAmount.equals(toDecimal(curr.membershipAmount))
    ) {
      diffs.push({
        changeType: 'MODIFIED',
        bookingId: curr.bookingId!,
        sessionId: curr.sessionId!,
        customerName: curr.customerName,
        customerPhone: curr.customerPhone,
        playerCount: curr.playerCount!,
        sessionPrice: toDecimal(curr.sessionPrice),
        bookingAmount: toDecimal(curr.bookingAmount),
        useMembership: curr.useMembership!,
        membershipAmount: toDecimal(curr.membershipAmount),
        original: {
          bookingId: orig.bookingId,
          playerCount: orig.playerCount,
          bookingAmount: orig.bookingAmount,
          useMembership: orig.useMembership,
          membershipAmount: orig.membershipAmount,
        },
      })
    }
  }

  for (const [bookingId, curr] of currentMap) {
    if (!originalMap.has(bookingId)) {
      diffs.push({
        changeType: 'ADDED',
        bookingId: curr.bookingId!,
        sessionId: curr.sessionId!,
        customerName: curr.customerName,
        customerPhone: curr.customerPhone,
        playerCount: curr.playerCount!,
        sessionPrice: toDecimal(curr.sessionPrice),
        bookingAmount: toDecimal(curr.bookingAmount),
        useMembership: curr.useMembership!,
        membershipAmount: toDecimal(curr.membershipAmount),
      })
    }
  }

  return diffs.sort((a, b) => {
    if (a.changeType === 'ADDED' && b.changeType !== 'ADDED') return -1
    if (a.changeType !== 'ADDED' && b.changeType === 'ADDED') return 1
    if (a.changeType === 'REMOVED' && b.changeType !== 'REMOVED') return -1
    if (a.changeType !== 'REMOVED' && b.changeType === 'REMOVED') return 1
    return (a.bookingId || 0) - (b.bookingId || 0)
  })
}

const compareTransactions = (
  original: StoreDailyCloseTransaction[],
  current: Prisma.StoreDailyCloseTransactionCreateManyDailyCloseInput[]
): TransactionDiffItem[] => {
  const diffs: TransactionDiffItem[] = []
  const originalMap = new Map(original.map(t => [t.transactionId, t]))
  const currentMap = new Map(current.map(t => [t.transactionId!, t]))

  for (const [transactionId, orig] of originalMap) {
    const curr = currentMap.get(transactionId)
    if (!curr) {
      diffs.push({
        changeType: 'REMOVED',
        transactionId: null,
        customerName: orig.customerName,
        customerPhone: orig.customerPhone,
        type: orig.type,
        amount: new Prisma.Decimal(0),
        balanceAfter: orig.balanceAfter,
        status: orig.status,
        remark: orig.remark,
        operator: orig.operator,
        relatedBookingId: orig.relatedBookingId,
        transactionCreatedAt: orig.transactionCreatedAt,
        original: {
          transactionId: orig.transactionId,
          amount: orig.amount,
          balanceAfter: orig.balanceAfter,
          status: orig.status,
        },
      })
    } else if (
      !orig.amount.equals(toDecimal(curr.amount)) ||
      !orig.balanceAfter.equals(toDecimal(curr.balanceAfter)) ||
      orig.status !== curr.status ||
      orig.type !== curr.type
    ) {
      diffs.push({
        changeType: 'MODIFIED',
        transactionId: curr.transactionId!,
        customerName: curr.customerName,
        customerPhone: curr.customerPhone,
        type: curr.type,
        amount: toDecimal(curr.amount),
        balanceAfter: toDecimal(curr.balanceAfter),
        status: curr.status!,
        remark: curr.remark || null,
        operator: curr.operator || null,
        relatedBookingId: curr.relatedBookingId || null,
        transactionCreatedAt: toDate(curr.transactionCreatedAt),
        original: {
          transactionId: orig.transactionId,
          amount: orig.amount,
          balanceAfter: orig.balanceAfter,
          status: orig.status,
        },
      })
    }
  }

  for (const [transactionId, curr] of currentMap) {
    if (!originalMap.has(transactionId)) {
      diffs.push({
        changeType: 'ADDED',
        transactionId: curr.transactionId!,
        customerName: curr.customerName,
        customerPhone: curr.customerPhone,
        type: curr.type,
        amount: toDecimal(curr.amount),
        balanceAfter: toDecimal(curr.balanceAfter),
        status: curr.status!,
        remark: curr.remark || null,
        operator: curr.operator || null,
        relatedBookingId: curr.relatedBookingId || null,
        transactionCreatedAt: toDate(curr.transactionCreatedAt),
      })
    }
  }

  return diffs.sort((a, b) => {
    if (a.changeType === 'ADDED' && b.changeType !== 'ADDED') return -1
    if (a.changeType !== 'ADDED' && b.changeType === 'ADDED') return 1
    if (a.changeType === 'REMOVED' && b.changeType !== 'REMOVED') return -1
    if (a.changeType !== 'REMOVED' && b.changeType === 'REMOVED') return 1
    return a.transactionCreatedAt.getTime() - b.transactionCreatedAt.getTime()
  })
}

export const getDailyCloseDiff = async (data: DailyCloseDiffData): Promise<DailyCloseDiffResult> => {
  const { storeId, businessDate } = data

  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) {
    throw new AppError('门店不存在', 404)
  }

  const originalClose = await getLatestNormalDailyClose(prisma, storeId, businessDate)
  if (!originalClose) {
    throw new AppError('该门店该营业日期暂无有效的日结单', 404)
  }

  const { startOfDay } = getDateRange(businessDate)
  const normalizedDate = startOfDay

  const [currentDataResult, recloseHistory] = await Promise.all([
    calculateDailyCloseData(prisma, storeId, normalizedDate),
    getRecloseHistory(prisma, storeId, normalizedDate),
  ])

  const { summary: currentSummary, sessionSnapshots, bookingSnapshots, transactionSnapshots } = currentDataResult

  const sessionDiffs = compareSessions(originalClose.sessionSnapshots, sessionSnapshots)
  const bookingDiffs = compareBookings(originalClose.bookingSnapshots, bookingSnapshots)
  const transactionDiffs = compareTransactions(originalClose.transactionSnapshots, transactionSnapshots)

  const diff = {
    completedSessionCount: currentSummary.completedSessionCount - originalClose.completedSessionCount,
    totalBookingCount: currentSummary.totalBookingCount - originalClose.totalBookingCount,
    totalPlayerCount: currentSummary.totalPlayerCount - originalClose.totalPlayerCount,
    receivableAmount: currentSummary.receivableAmount.minus(originalClose.receivableAmount),
    membershipConsume: currentSummary.membershipConsume.minus(originalClose.membershipConsume),
    membershipRecharge: currentSummary.membershipRecharge.minus(originalClose.membershipRecharge),
    refundAmount: currentSummary.refundAmount.minus(originalClose.refundAmount),
    discrepancyAmount: currentSummary.discrepancyAmount.minus(originalClose.discrepancyAmount),
  }

  const hasDifferences =
    diff.completedSessionCount !== 0 ||
    diff.totalBookingCount !== 0 ||
    diff.totalPlayerCount !== 0 ||
    !diff.receivableAmount.isZero() ||
    !diff.membershipConsume.isZero() ||
    !diff.membershipRecharge.isZero() ||
    !diff.refundAmount.isZero() ||
    !diff.discrepancyAmount.isZero()

  return {
    originalClose: {
      id: originalClose.id,
      businessDate: originalClose.businessDate,
      createdAt: originalClose.createdAt,
      operator: originalClose.operator,
      completedSessionCount: originalClose.completedSessionCount,
      totalBookingCount: originalClose.totalBookingCount,
      totalPlayerCount: originalClose.totalPlayerCount,
      receivableAmount: originalClose.receivableAmount,
      membershipConsume: originalClose.membershipConsume,
      membershipRecharge: originalClose.membershipRecharge,
      refundAmount: originalClose.refundAmount,
      discrepancyAmount: originalClose.discrepancyAmount,
      recloseCount: recloseHistory.length - 1,
    },
    currentData: {
      completedSessionCount: currentSummary.completedSessionCount,
      totalBookingCount: currentSummary.totalBookingCount,
      totalPlayerCount: currentSummary.totalPlayerCount,
      receivableAmount: currentSummary.receivableAmount,
      membershipConsume: currentSummary.membershipConsume,
      membershipRecharge: currentSummary.membershipRecharge,
      refundAmount: currentSummary.refundAmount,
      discrepancyAmount: currentSummary.discrepancyAmount,
    },
    diff,
    sessionDiffs,
    bookingDiffs,
    transactionDiffs,
    hasDifferences,
    recloseHistory,
  }
}

export const recloseDailyClose = async (data: DailyCloseRecloseData) => {
  const { storeId, businessDate, operator, remark } = data

  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) {
    throw new AppError('门店不存在', 404)
  }

  const { startOfDay } = getDateRange(businessDate)
  const normalizedDate = startOfDay

  return prisma.$transaction(async tx => {
    const currentClose = await getLatestNormalDailyClose(tx, storeId, normalizedDate)
    if (!currentClose) {
      throw new AppError('该门店该营业日期暂无有效的日结单', 404)
    }

    await tx.storeDailyClose.update({
      where: { id: currentClose.id },
      data: {
        status: StoreDailyCloseStatus.VOIDED,
      },
    })

    const { summary, sessionSnapshots, bookingSnapshots, transactionSnapshots } =
      await calculateDailyCloseData(tx, storeId, normalizedDate)

    const newClose = await tx.storeDailyClose.create({
      data: {
        storeId,
        businessDate: normalizedDate,
        status: StoreDailyCloseStatus.NORMAL,
        ...summary,
        operator,
        remark,
        originalCloseId: currentClose.id,
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

    const recloseHistory = await getRecloseHistory(tx, storeId, normalizedDate)

    return {
      voidedClose: {
        id: currentClose.id,
        status: StoreDailyCloseStatus.VOIDED,
        completedSessionCount: currentClose.completedSessionCount,
        totalBookingCount: currentClose.totalBookingCount,
        totalPlayerCount: currentClose.totalPlayerCount,
        receivableAmount: currentClose.receivableAmount,
        membershipConsume: currentClose.membershipConsume,
        membershipRecharge: currentClose.membershipRecharge,
        refundAmount: currentClose.refundAmount,
        discrepancyAmount: currentClose.discrepancyAmount,
      },
      newClose,
      recloseHistory,
      recloseCount: recloseHistory.length - 1,
    }
  })
}
