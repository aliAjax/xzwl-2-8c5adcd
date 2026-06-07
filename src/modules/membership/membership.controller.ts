import { Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  membershipActivateSchema,
  membershipRechargeSchema,
  membershipConsumeSchema,
  membershipRefundSchema,
  membershipTransactionQuerySchema,
  customerIdParamSchema,
} from '../../common/schemas'
import {
  activateMembership,
  recharge,
  consume,
  refund,
  getTransactionList,
  getMembershipAccountByCustomerId,
} from './membership.service'

type ActivateMembershipRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof membershipActivateSchema>
>

type RechargeRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof membershipRechargeSchema>
>

type ConsumeRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof membershipConsumeSchema>
>

type RefundRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof membershipRefundSchema>
>

type GetTransactionListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof membershipTransactionQuerySchema>,
  Record<string, never>
>

type GetAccountByCustomerIdRequest = TypedRequest<
  InferSchemaType<typeof customerIdParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const activateMembershipHandler = async (req: ActivateMembershipRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId, storeId, initialBalance, operator, remark } = req.body

    const result = await prisma.$transaction(async (tx) => {
      return activateMembership(tx, customerId, new Prisma.Decimal(initialBalance), operator, remark, storeId)
    })

    res.sendSuccess(result, '会员开通成功')
  } catch (error) {
    next(error)
  }
}

export const rechargeHandler = async (req: RechargeRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId, storeId, amount, operator, remark } = req.body

    const result = await prisma.$transaction(async (tx) => {
      return recharge(tx, customerId, new Prisma.Decimal(amount), operator, remark, storeId)
    })

    res.sendSuccess(result, '充值成功')
  } catch (error) {
    next(error)
  }
}

export const consumeHandler = async (req: ConsumeRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId, storeId, amount, operator, remark } = req.body

    const result = await prisma.$transaction(async (tx) => {
      return consume(tx, customerId, new Prisma.Decimal(amount), operator, remark, undefined, storeId)
    })

    res.sendSuccess(result, '扣款成功')
  } catch (error) {
    next(error)
  }
}

export const refundHandler = async (req: RefundRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId, storeId, amount, operator, remark, transactionId } = req.body

    const result = await prisma.$transaction(async (tx) => {
      return refund(tx, customerId, new Prisma.Decimal(amount), operator, remark, transactionId, storeId)
    })

    res.sendSuccess(result, '退款成功')
  } catch (error) {
    next(error)
  }
}

export const getTransactionListHandler = async (req: GetTransactionListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, storeId, customerId, type, status, startDate, endDate } = req.query

    const { transactions, total } = await getTransactionList(prisma, {
      page, pageSize, storeId, customerId, type, status, startDate, endDate,
    })

    res.sendSuccess(createPaginationResult(transactions, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getAccountByCustomerIdHandler = async (req: GetAccountByCustomerIdRequest, res: Response, next: NextFunction) => {
  try {
    const { customerId } = req.params

    const account = await getMembershipAccountByCustomerId(prisma, customerId)

    if (!account) {
      throw new AppError('该顾客未开通会员', 404)
    }

    res.sendSuccess(account)
  } catch (error) {
    next(error)
  }
}
