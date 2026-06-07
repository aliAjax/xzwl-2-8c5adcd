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
    const { days, scriptId, storeId } = req.query

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
    if (storeId) {
      where.storeId = storeId
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
        store: { select: { id: true, name: true } },
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
      storeId,
      total: result.length,
      list: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getHostStats = async (req: GetHostStatsRequest, res: Response, next: NextFunction) => {
  try {
    const { days, storeId } = req.query

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

    if (storeId) {
      where.storeId = storeId
    }

    const stats = await prisma.session.groupBy({
      by: ['hostId'],
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
      storeId,
      total: result.length,
      list: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getOverviewStats = async (req: GetOverviewStatsRequest, res: Response, next: NextFunction) => {
  try {
    const { days, storeId } = req.query

    const startDate = dayjs().subtract(days, 'day').toDate()
    const endDate = dayjs().toDate()

    const scriptWhere: Record<string, unknown> = { isActive: true }
    const hostWhere: Record<string, unknown> = { isActive: true }
    const sessionWhere: Record<string, unknown> = {}
    const bookingWhere: Record<string, unknown> = {}
    const periodSessionWhere: Record<string, unknown> = {
      startTime: { gte: startDate, lte: endDate },
      status: { notIn: [SessionStatus.CANCELLED] },
    }
    const periodBookingWhere: Record<string, unknown> = {
      createdAt: { gte: startDate, lte: endDate },
    }
    const upcomingWhere: Record<string, unknown> = {
      startTime: { gte: dayjs().toDate() },
      status: { notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED] },
    }
    const recentBookingWhere: Record<string, unknown> = {}

    if (storeId) {
      scriptWhere.storeId = storeId
      sessionWhere.storeId = storeId
      periodSessionWhere.storeId = storeId
      upcomingWhere.storeId = storeId
      hostWhere.stores = {
        some: { storeId }
      }
      bookingWhere.session = { storeId }
      periodBookingWhere.session = { storeId }
      recentBookingWhere.session = { storeId }
    }

    const [
      totalScripts,
      totalHosts,
      totalSessions,
      totalBookings,
      sessionsInPeriod,
      bookingsInPeriod,
    ] = await Promise.all([
      prisma.script.count({ where: scriptWhere }),
      prisma.host.count({ where: hostWhere }),
      prisma.session.count({ where: sessionWhere }),
      prisma.booking.count({ where: bookingWhere }),
      prisma.session.count({
        where: periodSessionWhere,
      }),
      prisma.booking.count({
        where: periodBookingWhere,
      }),
    ])

    const upcomingSessions = await prisma.session.findMany({
      where: upcomingWhere,
      include: {
        script: { select: { id: true, name: true } },
        host: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    })

    const recentBookings = await prisma.booking.findMany({
      where: recentBookingWhere,
      include: {
        session: {
          include: {
            script: { select: { id: true, name: true } },
            store: { select: { id: true, name: true } },
          },
        },
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const storeBreakdown = storeId ? undefined : await prisma.store.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            scripts: true,
            rooms: true,
          },
        },
      },
      orderBy: { id: 'asc' },
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
      storeId,
      storeBreakdown,
      upcomingSessions,
      recentBookings,
    })
  } catch (error) {
    next(error)
  }
}
