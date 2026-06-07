import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import { ProficiencyLevel, SessionStatus } from '@prisma/client'
import {
  hostSchema,
  hostUpdateSchema,
  paginationSchema,
  idParamSchema,
  hostRecommendSchema,
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

type RecommendHostsRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof hostRecommendSchema>
>

const proficiencyWeight: Record<ProficiencyLevel, number> = {
  [ProficiencyLevel.EXPERT]: 4,
  [ProficiencyLevel.PROFICIENT]: 3,
  [ProficiencyLevel.INTERMEDIATE]: 2,
  [ProficiencyLevel.BEGINNER]: 1,
}

const getConflictingHostIds = async (
  startTime: Date,
  endTime: Date
): Promise<Set<number>> => {
  const conflictingSessions = await prisma.session.findMany({
    where: {
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
    select: { hostId: true },
  })
  return new Set(conflictingSessions.map(s => s.hostId))
}

const getRecentWorkload = async (hostIds: number[]): Promise<Map<number, number>> => {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const workloads = await prisma.session.groupBy({
    by: ['hostId'],
    where: {
      hostId: { in: hostIds },
      startTime: { gte: sevenDaysAgo },
      status: { notIn: [SessionStatus.CANCELLED] },
    },
    _count: { hostId: true },
  })

  const workloadMap = new Map<number, number>()
  workloads.forEach(w => {
    workloadMap.set(w.hostId, w._count.hostId)
  })
  hostIds.forEach(id => {
    if (!workloadMap.has(id)) {
      workloadMap.set(id, 0)
    }
  })
  return workloadMap
}

const getLastHostTime = async (hostIds: number[]): Promise<Map<number, Date | null>> => {
  const lastSessions = await Promise.all(
    hostIds.map(hostId =>
      prisma.session.findFirst({
        where: {
          hostId,
          status: { notIn: [SessionStatus.CANCELLED] },
        },
        select: { endTime: true },
        orderBy: { endTime: 'desc' },
      })
    )
  )

  const timeMap = new Map<number, Date | null>()
  hostIds.forEach((id, index) => {
    timeMap.set(id, lastSessions[index]?.endTime || null)
  })
  return timeMap
}

export const recommendHosts = async (req: RecommendHostsRequest, res: Response, next: NextFunction) => {
  try {
    const { scriptId, startTime, endTime, limit } = req.body

    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, name: true, isActive: true },
    })

    if (!script) {
      throw new AppError('剧本不存在', 404)
    }
    if (!script.isActive) {
      throw new AppError('该剧本已被禁用', 400)
    }

    const conflictingHostIds = await getConflictingHostIds(startTime, endTime)

    const activeHosts = await prisma.host.findMany({
      where: {
        isActive: true,
        id: { notIn: Array.from(conflictingHostIds) },
      },
      include: {
        proficiencies: {
          where: { scriptId },
          include: {
            script: { select: { id: true, name: true } },
          },
        },
      },
    })

    const availableHostIds = activeHosts.map(h => h.id)
    const [workloadMap, lastTimeMap] = await Promise.all([
      getRecentWorkload(availableHostIds),
      getLastHostTime(availableHostIds),
    ])

    const proficientHosts = activeHosts.filter(h => h.proficiencies.length > 0)

    const createHostResult = (host: typeof activeHosts[0], hasProficiency: boolean) => {
      const proficiency = hasProficiency ? host.proficiencies[0] : null
      const workload = workloadMap.get(host.id) || 0
      const lastHostTime = lastTimeMap.get(host.id) || null
      const proficiencyScore = proficiency ? proficiencyWeight[proficiency.level] : 0

      return {
        id: host.id,
        name: host.name,
        phone: host.phone,
        avatar: host.avatar,
        proficiency: proficiency
          ? {
              level: proficiency.level,
              scriptId: proficiency.scriptId,
              scriptName: proficiency.script.name,
            }
          : null,
        recentWorkload: workload,
        lastHostTime,
        score: {
          proficiency: proficiencyScore,
          workload: workload,
          recency: lastHostTime ? lastHostTime.getTime() : 0,
        },
      }
    }

    const sortHosts = (hosts: ReturnType<typeof createHostResult>[]) => {
      return hosts.sort((a, b) => {
        if (b.score.proficiency !== a.score.proficiency) {
          return b.score.proficiency - a.score.proficiency
        }
        if (a.score.workload !== b.score.workload) {
          return a.score.workload - b.score.workload
        }
        return b.score.recency - a.score.recency
      })
    }

    let results: ReturnType<typeof createHostResult>[]
    let isFallback = false

    if (proficientHosts.length > 0) {
      results = sortHosts(proficientHosts.map(h => createHostResult(h, true)))
    } else {
      isFallback = true
      results = sortHosts(activeHosts.map(h => createHostResult(h, false)))
    }

    results = results.slice(0, limit)

    res.sendSuccess({
      hosts: results.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        avatar: r.avatar,
        proficiency: r.proficiency,
        recentWorkload: r.recentWorkload,
        lastHostTime: r.lastHostTime,
      })),
      isFallback,
      total: results.length,
    })
  } catch (error) {
    next(error)
  }
}

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
