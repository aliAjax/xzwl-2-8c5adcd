import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { SessionStatus } from '@prisma/client'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  sessionSchema,
  sessionUpdateSchema,
  sessionQuerySchema,
  availableSessionQuerySchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'

type CreateSessionRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof sessionSchema>
>


type UpdateSessionRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof sessionUpdateSchema>
>

type GetSessionListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof sessionQuerySchema>,
  Record<string, never>
>


type GetSessionByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>


type GetHostScheduleRequest = TypedRequest<
  { hostId: number },
  { startDate?: Date; endDate?: Date; storeId?: number },
  Record<string, never>
>


type GetAvailableSessionsRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof availableSessionQuerySchema>,
  Record<string, never>
>

const DEFAULT_STORE_ID = 1

export const checkHostConflict = async (
  hostId: number,
  startTime: Date,
  endTime: Date,
  excludeSessionId?: number
): Promise<boolean> => {
  const conflictingSessions = await prisma.session.findMany({
    where: {
      hostId,
      id: excludeSessionId ? { not: excludeSessionId } : undefined,
      status: {
        notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED],
      },
      OR: [
        {
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      ],
    },
    include: {
      script: { select: { name: true } },
      store: { select: { id: true, name: true } },
    },
  })

  if (conflictingSessions.length > 0) {
    const conflictInfo = conflictingSessions
      .map(s => `${s.store?.name || '未知门店'} - ${s.script.name} (${s.startTime.toLocaleString()} - ${s.endTime.toLocaleString()})`)
      .join(', ')
    throw new AppError(`主持人时间冲突（跨门店检测），已有场次：${conflictInfo}`, 409)
  }

  return false
}

export const checkRoomConflict = async (
  roomId: number,
  startTime: Date,
  endTime: Date,
  excludeSessionId?: number
): Promise<boolean> => {
  const conflictingSessions = await prisma.session.findMany({
    where: {
      roomId,
      id: excludeSessionId ? { not: excludeSessionId } : undefined,
      status: {
        notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED],
      },
      OR: [
        {
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      ],
    },
    include: {
      script: { select: { name: true } },
      room: { select: { name: true } },
    },
  })

  if (conflictingSessions.length > 0) {
    const conflictInfo = conflictingSessions
      .map(s => `${s.script.name} (${s.startTime.toLocaleString()} - ${s.endTime.toLocaleString()})`)
      .join(', ')
    throw new AppError(`房间时间冲突，已有场次：${conflictInfo}`, 409)
  }

  return false
}

export const createSession = async (req: CreateSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, scriptId, hostId, roomId, startTime, endTime, maxPlayers } = req.body
    const effectiveStoreId = storeId ?? DEFAULT_STORE_ID

    const [script, host, room, store] = await Promise.all([
      prisma.script.findUnique({ where: { id: scriptId } }),
      prisma.host.findUnique({
        where: { id: hostId },
        include: { stores: { where: { storeId: effectiveStoreId } } },
      }),
      prisma.room.findUnique({ where: { id: roomId } }),
      prisma.store.findUnique({ where: { id: effectiveStoreId } }),
    ])

    if (!store) {
      throw new AppError('门店不存在', 404)
    }
    if (!script) {
      throw new AppError('剧本不存在', 404)
    }
    if (script.storeId !== effectiveStoreId) {
      throw new AppError('剧本不属于该门店', 400)
    }
    if (!host) {
      throw new AppError('主持人不存在', 404)
    }
    if (!host.isActive) {
      throw new AppError('主持人已被禁用', 400)
    }
    if (host.stores.length === 0) {
      throw new AppError('主持人未分配到该门店', 400)
    }
    if (!room) {
      throw new AppError('房间不存在', 404)
    }
    if (room.storeId !== effectiveStoreId) {
      throw new AppError('房间不属于该门店', 400)
    }
    if (!room.isActive) {
      throw new AppError('该房间已被禁用', 400)
    }

    if (maxPlayers > script.maxPlayers) {
      throw new AppError(`场次人数不能超过剧本最大人数 ${script.maxPlayers} 人`, 400)
    }
    if (maxPlayers < script.minPlayers) {
      throw new AppError(`场次人数不能少于剧本最小人数 ${script.minPlayers} 人`, 400)
    }
    if (maxPlayers > room.capacity) {
      throw new AppError(`场次人数不能超过房间容量 ${room.capacity} 人`, 400)
    }

    await Promise.all([
      checkHostConflict(hostId, startTime, endTime),
      checkRoomConflict(roomId, startTime, endTime),
    ])

    const session = await prisma.session.create({
      data: {
        ...req.body,
        storeId: effectiveStoreId,
        currentPlayers: 0,
      },
      include: {
        store: { select: { id: true, name: true } },
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, capacity: true } },
      },
    })

    res.sendSuccess(session, '场次创建成功')
  } catch (error) {
    next(error)
  }
}

export const getSessionList = async (req: GetSessionListRequest, res: Response, next: NextFunction) => {
  try {
    const {
      page,
      pageSize,
      storeId,
      scriptId,
      hostId,
      roomId,
      status,
      startDate,
      endDate,
    } = req.query

    const where: Record<string, unknown> = {}
    if (storeId !== undefined) where.storeId = storeId
    if (scriptId) where.scriptId = scriptId
    if (hostId) where.hostId = hostId
    if (roomId) where.roomId = roomId
    if (status) where.status = status
    if (startDate && endDate) {
      where.startTime = { gte: startDate }
      where.endTime = { lte: endDate }
    } else if (startDate) {
      where.startTime = { gte: startDate }
    } else if (endDate) {
      where.endTime = { lte: endDate }
    }

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({
        where,
        include: {
          store: { select: { id: true, name: true } },
          script: { select: { id: true, name: true, minPlayers: true, maxPlayers: true } },
          host: { select: { id: true, name: true, phone: true } },
          room: { select: { id: true, name: true, capacity: true } },
          _count: {
            select: { bookings: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startTime: 'asc' },
      }),
      prisma.session.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(sessions, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getSessionById = async (req: GetSessionByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId } = req.query

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true } },
        script: {
          select: {
            id: true,
            name: true,
            description: true,
            minPlayers: true,
            maxPlayers: true,
            durationMin: true,
            difficulty: true,
            coverImage: true,
          },
        },
        host: { select: { id: true, name: true, phone: true, avatar: true } },
        room: { select: { id: true, name: true, capacity: true } },
        bookings: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    })

    if (!session) {
      throw new AppError('场次不存在', 404)
    }

    if (storeId !== undefined && session.storeId !== storeId) {
      throw new AppError('场次不属于该门店', 404)
    }

    res.sendSuccess(session)
  } catch (error) {
    next(error)
  }
}

export const updateSession = async (req: UpdateSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { hostId, roomId, startTime, endTime, scriptId, maxPlayers, status } = req.body

    const existingSession = await prisma.session.findUnique({
      where: { id },
      include: { script: true, room: true, host: { include: { stores: true } } },
    })

    if (!existingSession) {
      throw new AppError('场次不存在', 404)
    }

    const effectiveStoreId = existingSession.storeId

    const finalScriptId = scriptId || existingSession.scriptId
    const finalHostId = hostId || existingSession.hostId
    const finalRoomId = roomId || existingSession.roomId
    const finalStartTime = startTime || existingSession.startTime
    const finalEndTime = endTime || existingSession.endTime
    const finalMaxPlayers = maxPlayers || existingSession.maxPlayers

    const [script, host, room] = await Promise.all([
      scriptId
        ? prisma.script.findUnique({ where: { id: scriptId } })
        : Promise.resolve(existingSession.script),
      hostId
        ? prisma.host.findUnique({
            where: { id: hostId },
            include: { stores: { where: { storeId: effectiveStoreId } } },
          })
        : Promise.resolve(null),
      roomId
        ? prisma.room.findUnique({ where: { id: roomId } })
        : Promise.resolve(existingSession.room),
    ])

    if (scriptId && !script) {
      throw new AppError('剧本不存在', 404)
    }
    if (scriptId && script && script.storeId !== effectiveStoreId) {
      throw new AppError('剧本不属于该门店', 400)
    }
    if (roomId && !room) {
      throw new AppError('房间不存在', 404)
    }
    if (roomId && room && room.storeId !== effectiveStoreId) {
      throw new AppError('房间不属于该门店', 400)
    }
    if (room && !room.isActive) {
      throw new AppError('该房间已被禁用', 400)
    }
    if (hostId && host && !host.isActive) {
      throw new AppError('主持人已被禁用', 400)
    }
    if (hostId && host && host.stores.length === 0) {
      throw new AppError('主持人未分配到该门店', 400)
    }

    if (script) {
      if (finalMaxPlayers > script.maxPlayers) {
        throw new AppError(`场次人数不能超过剧本最大人数 ${script.maxPlayers} 人`, 400)
      }
      if (finalMaxPlayers < script.minPlayers) {
        throw new AppError(`场次人数不能少于剧本最小人数 ${script.minPlayers} 人`, 400)
      }
    }

    if (room) {
      if (finalMaxPlayers > room.capacity) {
        throw new AppError(`场次人数不能超过房间容量 ${room.capacity} 人`, 400)
      }
    }

    if (hostId && !host) {
      throw new AppError('主持人不存在', 404)
    }

    const isStatusRestored = status &&
      (existingSession.status === SessionStatus.CANCELLED || existingSession.status === SessionStatus.COMPLETED) &&
      status !== SessionStatus.CANCELLED && status !== SessionStatus.COMPLETED

    const conflictChecks: Promise<boolean>[] = []
    if (hostId || startTime || endTime || isStatusRestored) {
      conflictChecks.push(checkHostConflict(finalHostId, finalStartTime, finalEndTime, id))
    }
    if (roomId || startTime || endTime || isStatusRestored) {
      conflictChecks.push(checkRoomConflict(finalRoomId, finalStartTime, finalEndTime, id))
    }
    if (conflictChecks.length > 0) {
      await Promise.all(conflictChecks)
    }

    const session = await prisma.session.update({
      where: { id },
      data: req.body,
      include: {
        store: { select: { id: true, name: true } },
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, capacity: true } },
      },
    })

    res.sendSuccess(session, '场次更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteSession = async (req: GetSessionByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingSession = await prisma.session.findUnique({
      where: { id },
    })
    if (!existingSession) {
      throw new AppError('场次不存在', 404)
    }

    await prisma.session.delete({
      where: { id },
    })

    res.sendSuccess(null, '场次删除成功')
  } catch (error) {
    next(error)
  }
}

export const getHostSchedule = async (req: GetHostScheduleRequest, res: Response, next: NextFunction) => {
  try {
    const { hostId } = req.params
    const { startDate, endDate, storeId } = req.query

    const host = await prisma.host.findUnique({ where: { id: hostId } })
    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    const where: Record<string, unknown> = {
      hostId,
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
        room: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    })

    res.sendSuccess(schedule)
  } catch (error) {
    next(error)
  }
}

export const getAvailableSessions = async (req: GetAvailableSessionsRequest, res: Response, next: NextFunction) => {
  try {
    const {
      page,
      pageSize,
      storeId,
      scriptId,
      startDate,
      endDate,
      playerCount,
      difficulty,
      keyword,
    } = req.query

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    conditions.push(`s."status" NOT IN ($${paramIndex}, $${paramIndex + 1})`)
    params.push(SessionStatus.CANCELLED, SessionStatus.COMPLETED)
    paramIndex += 2

    conditions.push(`(s."maxPlayers" - s."currentPlayers") > 0`)

    if (storeId !== undefined) {
      conditions.push(`s."storeId" = $${paramIndex}`)
      params.push(storeId)
      paramIndex++
    }

    if (scriptId) {
      conditions.push(`s."scriptId" = $${paramIndex}`)
      params.push(scriptId)
      paramIndex++
    }

    if (startDate) {
      conditions.push(`s."startTime" >= $${paramIndex}`)
      params.push(startDate)
      paramIndex++
    }

    if (endDate) {
      conditions.push(`s."endTime" <= $${paramIndex}`)
      params.push(endDate)
      paramIndex++
    }

    if (difficulty) {
      conditions.push(`sc."difficulty" = $${paramIndex}`)
      params.push(difficulty)
      paramIndex++
    }

    if (keyword) {
      conditions.push(`(sc."name" ILIKE $${paramIndex} OR sc."description" ILIKE $${paramIndex})`)
      params.push(`%${keyword}%`)
      paramIndex++
    }

    if (playerCount) {
      conditions.push(`s."maxPlayers" >= $${paramIndex}`)
      params.push(playerCount)
      paramIndex++
      conditions.push(`(s."maxPlayers" - s."currentPlayers") >= $${paramIndex}`)
      params.push(playerCount)
      paramIndex++
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const countParams = [...params]

    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Session" s
      INNER JOIN "Script" sc ON s."scriptId" = sc."id"
      ${whereClause}
    `

    const dataQuery = `
      SELECT 
        s."id", s."storeId", s."scriptId", s."hostId", s."roomId", s."startTime", s."endTime",
        s."status", s."price", s."currentPlayers", s."maxPlayers", s."remark",
        s."createdAt", s."updatedAt",
        (s."maxPlayers" - s."currentPlayers") as "remainingSeats",
        json_build_object(
          'id', st."id", 'name', st."name"
        ) as store,
        json_build_object(
          'id', sc."id", 'name', sc."name", 'description', sc."description",
          'minPlayers', sc."minPlayers", 'maxPlayers', sc."maxPlayers",
          'durationMin', sc."durationMin", 'difficulty', sc."difficulty",
          'coverImage', sc."coverImage"
        ) as script,
        json_build_object(
          'id', h."id", 'name', h."name", 'avatar', h."avatar"
        ) as host,
        json_build_object(
          'id', r."id", 'name', r."name", 'capacity', r."capacity"
        ) as room
      FROM "Session" s
      INNER JOIN "Script" sc ON s."scriptId" = sc."id"
      INNER JOIN "Host" h ON s."hostId" = h."id"
      INNER JOIN "Room" r ON s."roomId" = r."id"
      INNER JOIN "Store" st ON s."storeId" = st."id"
      ${whereClause}
      ORDER BY s."startTime" ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `
    const dataParams = [...params, pageSize, (page - 1) * pageSize]

    const [countResult, dataResult] = await Promise.all([
      prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery, ...countParams),
      prisma.$queryRawUnsafe(dataQuery, ...dataParams),
    ])

    const total = Number(countResult[0]?.total || 0)

    const resultList = (dataResult as unknown[]).map(item => {
      const record = item as Record<string, unknown>
      return {
        id: record.id,
        storeId: record.storeId,
        scriptId: record.scriptId,
        hostId: record.hostId,
        roomId: record.roomId,
        startTime: record.startTime,
        endTime: record.endTime,
        status: record.status,
        price: record.price,
        currentPlayers: record.currentPlayers,
        maxPlayers: record.maxPlayers,
        remark: record.remark,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        remainingSeats: record.remainingSeats,
        store: record.store,
        script: record.script,
        host: record.host,
        room: record.room,
      }
    })

    res.sendSuccess(createPaginationResult(resultList, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}
