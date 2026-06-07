import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import { SessionStatus } from '@prisma/client'
import {
  storeSchema,
  storeUpdateSchema,
  paginationSchema,
  idParamSchema,
  hostAssignStoreSchema,
} from '../../common/schemas'

type CreateStoreRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof storeSchema>
>

type UpdateStoreRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof storeUpdateSchema>
>

type GetStoreListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof paginationSchema>,
  Record<string, never>
>

type GetStoreByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type AssignHostStoreRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof hostAssignStoreSchema>
>

export const createStore = async (req: CreateStoreRequest, res: Response, next: NextFunction) => {
  try {
    const existingStore = await prisma.store.findUnique({
      where: { name: req.body.name },
    })

    if (existingStore) {
      throw new AppError('门店名称已存在', 409)
    }

    const store = await prisma.store.create({
      data: req.body,
    })

    res.sendSuccess(store, '门店创建成功')
  } catch (error) {
    next(error)
  }
}

export const getStoreList = async (req: GetStoreListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword } = req.query

    const where: Record<string, unknown> = {}
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { address: { contains: keyword } },
      ]
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.store.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(stores, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getStoreById = async (req: GetStoreByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const store = await prisma.store.findUnique({
      where: { id },
      include: {
        scripts: { where: { isActive: true }, take: 5, orderBy: { createdAt: 'desc' } },
        rooms: { where: { isActive: true }, take: 5, orderBy: { createdAt: 'desc' } },
        hosts: {
          include: {
            host: { select: { id: true, name: true, phone: true, avatar: true } },
          },
          take: 10,
        },
      },
    })

    if (!store) {
      throw new AppError('门店不存在', 404)
    }

    res.sendSuccess(store)
  } catch (error) {
    next(error)
  }
}

export const updateStore = async (req: UpdateStoreRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { name } = req.body

    const existingStore = await prisma.store.findUnique({
      where: { id },
    })

    if (!existingStore) {
      throw new AppError('门店不存在', 404)
    }

    if (name && name !== existingStore.name) {
      const duplicateStore = await prisma.store.findUnique({
        where: { name },
      })
      if (duplicateStore) {
        throw new AppError('门店名称已存在', 409)
      }
    }

    const store = await prisma.store.update({
      where: { id },
      data: req.body,
    })

    res.sendSuccess(store, '门店更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteStore = async (req: GetStoreByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingStore = await prisma.store.findUnique({
      where: { id },
    })

    if (!existingStore) {
      throw new AppError('门店不存在', 404)
    }

    if (id === 1) {
      throw new AppError('默认门店无法删除', 409)
    }

    const activeSessions = await prisma.session.count({
      where: {
        storeId: id,
        status: {
          notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED],
        },
      },
    })

    if (activeSessions > 0) {
      throw new AppError('该门店存在未完成或未取消的场次，无法删除', 409)
    }

    await prisma.store.delete({
      where: { id },
    })

    res.sendSuccess(null, '门店删除成功')
  } catch (error) {
    next(error)
  }
}

export const assignHostToStores = async (req: AssignHostStoreRequest, res: Response, next: NextFunction) => {
  try {
    const { hostId, storeIds } = req.body

    const host = await prisma.host.findUnique({
      where: { id: hostId },
    })

    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
    })

    if (stores.length !== storeIds.length) {
      const existingIds = stores.map(s => s.id)
      const missingIds = storeIds.filter(id => !existingIds.includes(id))
      throw new AppError(`门店不存在: ${missingIds.join(', ')}`, 404)
    }

    await prisma.$transaction(async (tx) => {
      await tx.hostStore.deleteMany({
        where: { hostId },
      })

      await tx.hostStore.createMany({
        data: storeIds.map(storeId => ({
          hostId,
          storeId,
        })),
      })
    })

    const updatedHost = await prisma.host.findUnique({
      where: { id: hostId },
      include: {
        stores: {
          include: {
            store: { select: { id: true, name: true } },
          },
        },
      },
    })

    res.sendSuccess(updatedHost, '主持人门店分配成功')
  } catch (error) {
    next(error)
  }
}
