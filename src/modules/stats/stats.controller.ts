import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import dayjs from 'dayjs'
import { SessionStatus } from '@prisma/client'
import { TypedRequest, InferSchemaType } from '../../common/express'
import { statsQuerySchema } from '../../common/schemas'

type GetScriptStatsRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof statsQuerySchema>,
  Record<string, never>
>

type GetHostStatsRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof statsQuerySchema>,
  Record<string, never>
>

type GetOverviewStatsRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof statsQuerySchema>,
  Record<string, never>
>

export const getScriptStats = async (req: GetScriptStatsRequest, res: Response, next: NextFunction) => {
  try {
    const { days, scriptId } = req.query

    const startDate = dayjs().subtract(days, 'day').toDate()
    const endDate = dayjs().toDate()

    const where: Record<string, unknown> = {
      startTime: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        notIn: [SessionStatus.CANCELLED],
      },
    }

    if (scriptId) {
      where.scriptId = scriptId
    }

    const stats = await prisma.session.groupBy({
      by: ['scriptId'],
      where,
      _count: {
        id: true,
      },
      _sum: {
        currentPlayers: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    })

    const scriptIds = stats.map(s => s.scriptId)
    const scripts = await prisma.script.findMany({
      where: {
        id: {
          in: scriptIds,
        },
      },
      select: {
        id: true,
        name: true,
        difficulty: true,
        coverImage: true,
      },
    })

    const scriptMap = new Map(scripts.map(s => [s.id, s]))

    const result = stats.map(s => ({
      script: scriptMap.get(s.scriptId),
      sessionCount: s._count.id,
      totalPlayers: s._sum.currentPlayers || 0,
    }))

    res.sendSuccess({
      period: {
        startDate,
        endDate,
        days,
      },
      total: result.length,
      list: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getHostStats = async (req: GetHostStatsRequest, res: Response, next: NextFunction) => {
  try {
    const { days } = req.query

    const startDate = dayjs().subtract(days, 'day').toDate()
    const endDate = dayjs().toDate()

    const stats = await prisma.session.groupBy({
      by: ['hostId'],
      where: {
        startTime: {
          gte: startDate,
          lte: endDate,
        },
        status: {
          notIn: [SessionStatus.CANCELLED],
        },
      },
      _count: {
        id: true,
      },
      _sum: {
        currentPlayers: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    })

    const hostIds = stats.map(s => s.hostId)
    const hosts = await prisma.host.findMany({
      where: {
        id: {
          in: hostIds,
        },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        avatar: true,
      },
    })

    const hostMap = new Map(hosts.map(h => [h.id, h]))

    const result = stats.map(s => ({
      host: hostMap.get(s.hostId),
      sessionCount: s._count.id,
      totalPlayers: s._sum.currentPlayers || 0,
    }))

    res.sendSuccess({
      period: {
        startDate,
        endDate,
        days,
      },
      total: result.length,
      list: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getOverviewStats = async (req: GetOverviewStatsRequest, res: Response, next: NextFunction) => {
  try {
    const { days } = req.query

    const startDate = dayjs().subtract(days, 'day').toDate()
    const endDate = dayjs().toDate()

    const [
      totalScripts,
      totalHosts,
      totalSessions,
      totalBookings,
      sessionsInPeriod,
      bookingsInPeriod,
    ] = await Promise.all([
      prisma.script.count({ where: { isActive: true } }),
      prisma.host.count({ where: { isActive: true } }),
      prisma.session.count(),
      prisma.booking.count(),
      prisma.session.count({
        where: {
          startTime: { gte: startDate, lte: endDate },
          status: { notIn: [SessionStatus.CANCELLED] },
        },
      }),
      prisma.booking.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
    ])

    const upcomingSessions = await prisma.session.findMany({
      where: {
        startTime: { gte: dayjs().toDate() },
        status: { notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED] },
      },
      include: {
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    })

    const recentBookings = await prisma.booking.findMany({
      include: {
        session: {
          include: {
            script: { select: { id: true, name: true } },
          },
        },
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    res.sendSuccess({
      overview: {
        totalScripts,
        totalHosts,
        totalSessions,
        totalBookings,
        sessionsInPeriod,
        bookingsInPeriod,
      },
      period: {
        startDate,
        endDate,
        days,
      },
      upcomingSessions,
      recentBookings,
    })
  } catch (error) {
    next(error)
  }
}
