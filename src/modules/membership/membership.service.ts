import { Prisma, MembershipTransactionType, MembershipTransactionStatus } from '@prisma/client'
import { AppError } from '../../middleware/errorHandler'

export interface MembershipTransactionCreateData {
  accountId: number
  storeId?: number
  type: MembershipTransactionType
  amount: Prisma.Decimal
  remark?: string
  operator?: string
  relatedBookingId?: number
}

const createTransaction = async (
  tx: Prisma.TransactionClient,
  accountId: number,
  type: MembershipTransactionType,
  amount: Prisma.Decimal,
  balanceAfter: Prisma.Decimal,
  remark?: string,
  operator?: string,
  relatedBookingId?: number,
  storeId?: number
) => {
  if (storeId !== undefined) {
    const store = await tx.store.findUnique({ where: { id: storeId } })
    if (!store) {
      throw new AppError('门店不存在', 404)
    }
  }

  return tx.membershipTransaction.create({
    data: {
      accountId,
      storeId,
      type,
      amount,
      balanceAfter,
      status: MembershipTransactionStatus.SUCCESS,
      remark,
      operator,
      relatedBookingId,
    },
  })
}

export const getMembershipAccountByCustomerId = async (
  tx: Prisma.TransactionClient | typeof import('../../prisma/client').default,
  customerId: number
) => {
  const account = await tx.membershipAccount.findUnique({
    where: { customerId },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  })
  return account
}

export const activateMembership = async (
  tx: Prisma.TransactionClient,
  customerId: number,
  initialBalance: Prisma.Decimal,
  operator?: string,
  remark?: string,
  storeId?: number
) => {
  const customer = await tx.customer.findUnique({ where: { id: customerId } })
  if (!customer) {
    throw new AppError('顾客不存在', 404)
  }

  const existingAccount = await tx.membershipAccount.findUnique({ where: { customerId } })
  if (existingAccount) {
    if (existingAccount.isActive) {
      throw new AppError('该顾客已是会员', 400)
    }
    const reactivatedAccount = await tx.membershipAccount.update({
      where: { customerId },
      data: { isActive: true },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    })
    return { account: reactivatedAccount, transaction: null }
  }

  const account = await tx.membershipAccount.create({
    data: {
      customerId,
      balance: initialBalance,
      isActive: true,
    },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  })

  let transaction = null
  if (initialBalance.gt(0)) {
    transaction = await createTransaction(
      tx,
      account.id,
      MembershipTransactionType.RECHARGE,
      initialBalance,
      initialBalance,
      remark || '开户赠送',
      operator,
      undefined,
      storeId
    )
  }

  return { account, transaction }
}

export const recharge = async (
  tx: Prisma.TransactionClient,
  customerId: number,
  amount: Prisma.Decimal,
  operator?: string,
  remark?: string,
  storeId?: number
) => {
  const account = await getMembershipAccountByCustomerId(tx, customerId)
  if (!account) {
    throw new AppError('该顾客未开通会员', 404)
  }
  if (!account.isActive) {
    throw new AppError('会员账户已冻结', 400)
  }

  const newBalance = account.balance.plus(amount)

  const updatedAccount = await tx.membershipAccount.update({
    where: { id: account.id },
    data: { balance: newBalance },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  })

  const transaction = await createTransaction(
    tx,
    account.id,
    MembershipTransactionType.RECHARGE,
    amount,
    newBalance,
    remark,
    operator,
    undefined,
    storeId
  )

  return { account: updatedAccount, transaction }
}

export const consume = async (
  tx: Prisma.TransactionClient,
  customerId: number,
  amount: Prisma.Decimal,
  operator?: string,
  remark?: string,
  relatedBookingId?: number,
  storeId?: number
) => {
  const account = await getMembershipAccountByCustomerId(tx, customerId)
  if (!account) {
    throw new AppError('该顾客未开通会员', 404)
  }
  if (!account.isActive) {
    throw new AppError('会员账户已冻结', 400)
  }
  if (account.balance.lt(amount)) {
    throw new AppError(`余额不足，当前余额: ${account.balance.toString()}`, 400)
  }

  const newBalance = account.balance.minus(amount)

  const updatedAccount = await tx.membershipAccount.update({
    where: { id: account.id },
    data: { balance: newBalance },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  })

  const transaction = await createTransaction(
    tx,
    account.id,
    MembershipTransactionType.CONSUME,
    amount,
    newBalance,
    remark,
    operator,
    relatedBookingId,
    storeId
  )

  return { account: updatedAccount, transaction }
}

export const refund = async (
  tx: Prisma.TransactionClient,
  customerId: number,
  amount: Prisma.Decimal,
  operator?: string,
  remark?: string,
  relatedBookingId?: number,
  storeId?: number
) => {
  const account = await getMembershipAccountByCustomerId(tx, customerId)
  if (!account) {
    throw new AppError('该顾客未开通会员', 404)
  }
  if (!account.isActive) {
    throw new AppError('会员账户已冻结', 400)
  }

  const newBalance = account.balance.plus(amount)

  const updatedAccount = await tx.membershipAccount.update({
    where: { id: account.id },
    data: { balance: newBalance },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  })

  const transaction = await createTransaction(
    tx,
    account.id,
    MembershipTransactionType.REFUND,
    amount,
    newBalance,
    remark,
    operator,
    relatedBookingId,
    storeId
  )

  return { account: updatedAccount, transaction }
}

export const getTransactionList = async (
  prisma: typeof import('../../prisma/client').default,
  query: {
    page: number
    pageSize: number
    storeId?: number
    customerId?: number
    type?: MembershipTransactionType
    status?: MembershipTransactionStatus
    startDate?: Date
    endDate?: Date
  }
) => {
  const { page, pageSize, storeId, customerId, type, status, startDate, endDate } = query

  const where: any = {}
  if (customerId) {
    where.account = { customerId }
  }
  if (storeId) {
    where.OR = [
      { storeId },
      {
        relatedBooking: {
          session: { storeId },
        },
      },
    ]
  }
  if (type) where.type = type
  if (status) where.status = status
  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = startDate
    if (endDate) where.createdAt.lte = endDate
  }

  const [transactions, total] = await Promise.all([
    prisma.membershipTransaction.findMany({
      where,
      include: {
        account: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        store: { select: { id: true, name: true } },
        relatedBooking: {
          select: {
            id: true,
            status: true,
            session: {
              select: {
                id: true,
                startTime: true,
                script: { select: { id: true, name: true } },
                store: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.membershipTransaction.count({ where }),
  ])

  return { transactions, total }
}
