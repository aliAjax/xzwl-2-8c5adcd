import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  hostSchema,
  hostUpdateSchema,
  paginationSchema,
  idParamSchema,
} from '../../common/schemas'

type CreateHostRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof hostSchema>
>

type UpdateHostRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof hostUpdateSchema>
>

type GetHostListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof paginationSchema>,
  Record<string, never>
>

type GetHostByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const createHost = async (req: CreateHostRequest, res: Response, next: NextFunction) => {
  try {
    const host = await prisma.host.create({
      data: req.body,
    })
    res.sendSuccess(host, '主持人创建成功')
  } catch (error) {
    next(error)
  }
}

export const getHostList = async (req: GetHostListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword } = req.query

    const where: Record<string, unknown> = {}
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { phone: { contains: keyword } },
      ]
    }

    const [hosts, total] = await Promise.all([
      prisma.host.findMany({
        where,
        include: {
          proficiencies: {
            include: {
              script: {
                select: { id: true, name: true },
              },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.host.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(hosts, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getHostById = async (req: GetHostByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const host = await prisma.host.findUnique({
      where: { id },
      include: {
        proficiencies: {
          include: {
            script: {
              select: { id: true, name: true, difficulty: true },
            },
          },
        },
        sessions: {
          take: 10,
          orderBy: { startTime: 'desc' },
          include: {
            script: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    res.sendSuccess(host)
  } catch (error) {
    next(error)
  }
}

export const updateHost = async (req: UpdateHostRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const host = await prisma.host.update({
      where: { id },
      data: req.body,
    })

    res.sendSuccess(host, '主持人更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteHost = async (req: GetHostByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    await prisma.host.delete({
      where: { id },
    })

    res.sendSuccess(null, '主持人删除成功')
  } catch (error) {
    next(error)
  }
}
