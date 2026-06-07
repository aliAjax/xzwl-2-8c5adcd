import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  roomSchema,
  roomUpdateSchema,
  roomQuerySchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'
import { SessionStatus } from '@prisma/client'

type CreateRoomRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof roomSchema>
>


type UpdateRoomRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof roomUpdateSchema>
>

type GetRoomListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof roomQuerySchema>,
  Record<string, never>
>


type GetRoomByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

const DEFAULT_STORE_ID = 1

export const createRoom = async (req: CreateRoomRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, ...data } = req.body
    const effectiveStoreId = storeId ?? DEFAULT_STORE_ID

    const store = await prisma.store.findUnique({
      where: { id: effectiveStoreId },
    })
    if (!store) {
      throw new AppError('门店不存在', 404)
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        storeId_name: {
          storeId: effectiveStoreId,
          name: data.name,
        },
      },
    })

    if (existingRoom) {
      throw new AppError('该门店下房间名称已存在', 409)
    }

    const room = await prisma.room.create({
      data: {
        ...data,
        storeId: effectiveStoreId,
      },
    })

    res.sendSuccess(room, '房间创建成功')
  } catch (error) {
    next(error)
  }
}

export const getRoomList = async (req: GetRoomListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, isActive, keyword, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (storeId !== undefined) {
      where.storeId = storeId
    }
    if (isActive !== undefined) {
      where.isActive = isActive
    }
    if (keyword) {
      where.name = { contains: keyword }
    }

    const [rooms, total] = await Promise.all([
      prisma.room.findMany({
        where,
        include: {
          store: { select: { id: true, name: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.room.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(rooms, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getRoomById = async (req: GetRoomByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId } = req.query

    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true } },
        sessions: {
          take: 10,
          orderBy: { startTime: 'desc' },
          include: {
            script: { select: { id: true, name: true } },
            host: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!room) {
      throw new AppError('房间不存在', 404)
    }

    if (storeId !== undefined && room.storeId !== storeId) {
      throw new AppError('房间不属于该门店', 404)
    }

    res.sendSuccess(room)
  } catch (error) {
    next(error)
  }
}

export const updateRoom = async (req: UpdateRoomRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId, name, ...data } = req.body

    const existingRoom = await prisma.room.findUnique({
      where: { id },
    })

    if (!existingRoom) {
      throw new AppError('房间不存在', 404)
    }

    const effectiveStoreId = storeId ?? existingRoom.storeId

    if (storeId !== undefined && storeId !== existingRoom.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
      })
      if (!store) {
        throw new AppError('门店不存在', 404)
      }
    }

    if (name && name !== existingRoom.name) {
      const duplicateRoom = await prisma.room.findUnique({
        where: {
          storeId_name: {
            storeId: effectiveStoreId,
            name,
          },
        },
      })
      if (duplicateRoom && duplicateRoom.id !== id) {
        throw new AppError('该门店下房间名称已存在', 409)
      }
    }

    const room = await prisma.room.update({
      where: { id },
      data: {
        ...data,
        ...(name !== undefined && { name }),
        ...(storeId !== undefined && { storeId }),
      },
    })

    res.sendSuccess(room, '房间更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteRoom = async (req: GetRoomByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingRoom = await prisma.room.findUnique({
      where: { id },
    })

    if (!existingRoom) {
      throw new AppError('房间不存在', 404)
    }

    const activeSessions = await prisma.session.count({
      where: {
        roomId: id,
        status: {
          notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED],
        },
      },
    })

    if (activeSessions > 0) {
      throw new AppError('该房间存在未完成或未取消的场次，无法删除', 409)
    }

    await prisma.room.delete({
      where: { id },
    })

    res.sendSuccess(null, '房间删除成功')
  } catch (error) {
    next(error)
  }
}

export const getRoomSchedule = async (req: GetRoomByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { startDate, endDate, storeId } = req.query as { startDate?: Date; endDate?: Date; storeId?: number }

    const room = await prisma.room.findUnique({
      where: { id },
    })

    if (!room) {
      throw new AppError('房间不存在', 404)
    }

    if (storeId !== undefined && room.storeId !== storeId) {
      throw new AppError('房间不属于该门店', 404)
    }

    const where: Record<string, unknown> = {
      roomId: id,
      status: { notIn: [SessionStatus.CANCELLED] },
    }

    if (storeId !== undefined) {
      where.storeId = storeId
    }

    if (startDate && endDate) {
      where.startTime = { gte: startDate }
      where.endTime = { lte: endDate }
    } else if (startDate) {
      where.startTime = { gte: startDate }
    } else if (endDate) {
      where.endTime = { lte: endDate }
    }

    const schedule = await prisma.session.findMany({
      where,
      include: {
        store: { select: { id: true, name: true } },
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    })

    res.sendSuccess(schedule)
  } catch (error) {
    next(error)
  }
}
