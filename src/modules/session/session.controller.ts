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
  idParamSchema,
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
  Record<string, never>,
  Record<string, never>
>

type GetHostScheduleRequest = TypedRequest<
  { hostId: number },
  { startDate?: Date; endDate?: Date },
  Record<string, never>
>

const checkHostConflict = async (
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
    },
  })

  if (conflictingSessions.length > 0) {
    const conflictInfo = conflictingSessions
      .map(s => `${s.script.name} (${s.startTime.toLocaleString()} - ${s.endTime.toLocaleString()})`)
      .join(', ')
    throw new AppError(`主持人时间冲突，已有场次：${conflictInfo}`, 409)
  }

  return false
}

export const createSession = async (req: CreateSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { scriptId, hostId, startTime, endTime, maxPlayers } = req.body

    const [script, host] = await Promise.all([
      prisma.script.findUnique({ where: { id: scriptId } }),
      prisma.host.findUnique({ where: { id: hostId } }),
    ])

    if (!script) {
      throw new AppError('剧本不存在', 404)
    }
    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    if (maxPlayers > script.maxPlayers) {
      throw new AppError(`场次人数不能超过剧本最大人数 ${script.maxPlayers} 人`, 400)
    }
    if (maxPlayers < script.minPlayers) {
      throw new AppError(`场次人数不能少于剧本最小人数 ${script.minPlayers} 人`, 400)
    }

    await checkHostConflict(hostId, startTime, endTime)

    const session = await prisma.session.create({
      data: {
        ...req.body,
        currentPlayers: 0,
      },
      include: {
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
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
      scriptId,
      hostId,
      status,
      startDate,
      endDate,
    } = req.query

    const where: Record<string, unknown> = {}
    if (scriptId) where.scriptId = scriptId
    if (hostId) where.hostId = hostId
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
          script: { select: { id: true, name: true, minPlayers: true, maxPlayers: true } },
          host: { select: { id: true, name: true, phone: true } },
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

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
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

    res.sendSuccess(session)
  } catch (error) {
    next(error)
  }
}

export const updateSession = async (req: UpdateSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { hostId, startTime, endTime, scriptId, maxPlayers } = req.body

    const existingSession = await prisma.session.findUnique({
      where: { id },
      include: { script: true },
    })

    if (!existingSession) {
      throw new AppError('场次不存在', 404)
    }

    const finalScriptId = scriptId || existingSession.scriptId
    const finalHostId = hostId || existingSession.hostId
    const finalStartTime = startTime || existingSession.startTime
    const finalEndTime = endTime || existingSession.endTime
    const finalMaxPlayers = maxPlayers || existingSession.maxPlayers

    if (scriptId) {
      const script = await prisma.script.findUnique({ where: { id: scriptId } })
      if (!script) {
        throw new AppError('剧本不存在', 404)
      }
      if (finalMaxPlayers > script.maxPlayers) {
        throw new AppError(`场次人数不能超过剧本最大人数 ${script.maxPlayers} 人`, 400)
      }
      if (finalMaxPlayers < script.minPlayers) {
        throw new AppError(`场次人数不能少于剧本最小人数 ${script.minPlayers} 人`, 400)
      }
    } else {
      if (finalMaxPlayers > existingSession.script.maxPlayers) {
        throw new AppError(`场次人数不能超过剧本最大人数 ${existingSession.script.maxPlayers} 人`, 400)
      }
      if (finalMaxPlayers < existingSession.script.minPlayers) {
        throw new AppError(`场次人数不能少于剧本最小人数 ${existingSession.script.minPlayers} 人`, 400)
      }
    }

    if (hostId) {
      const host = await prisma.host.findUnique({ where: { id: hostId } })
      if (!host) {
        throw new AppError('主持人不存在', 404)
      }
    }

    if (hostId || startTime || endTime) {
      await checkHostConflict(finalHostId, finalStartTime, finalEndTime, id)
    }

    const session = await prisma.session.update({
      where: { id },
      data: req.body,
      include: {
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
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
    const { startDate, endDate } = req.query

    const host = await prisma.host.findUnique({ where: { id: hostId } })
    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    const where: Record<string, unknown> = {
      hostId,
      status: { notIn: [SessionStatus.CANCELLED] },
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
        script: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    })

    res.sendSuccess(schedule)
  } catch (error) {
    next(error)
  }
}
