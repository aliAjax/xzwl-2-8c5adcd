import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  customerQuerySchema,
  customerUpdateSchema,
  idParamSchema,
} from '../../common/schemas'

type GetCustomerListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof customerQuerySchema>,
  Record<string, never>
>

type GetCustomerByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type UpdateCustomerRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof customerUpdateSchema>
>

export const getCustomerList = async (req: GetCustomerListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { phone: { contains: keyword } },
      ]
    }
    if (storeId) {
      where.bookings = {
        some: {
          session: {
            storeId,
          },
        },
      }
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          _count: {
            select: { bookings: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(customers, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getCustomerById = async (req: GetCustomerByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        bookings: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            session: {
              include: {
                script: { select: { id: true, name: true } },
                host: { select: { id: true, name: true } },
                store: { select: { id: true, name: true } },
              },
            },
          },
        },
        _count: {
          select: { bookings: true },
        },
      },
    })

    if (!customer) {
      throw new AppError('顾客不存在', 404)
    }

    res.sendSuccess(customer)
  } catch (error) {
    next(error)
  }
}

export const updateCustomer = async (req: UpdateCustomerRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { phone } = req.body

    if (phone) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { phone },
      })
      if (existingCustomer && existingCustomer.id !== id) {
        throw new AppError('该手机号已被其他顾客使用', 400)
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: req.body,
    })

    res.sendSuccess(customer, '顾客信息更新成功')
  } catch (error) {
    next(error)
  }
}
