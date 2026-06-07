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
  detailQuerySchema,
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
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>


type RecommendHostsRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof hostRecommendSchema>
>


const DEFAULT_STORE_ID = 1

const proficiencyWeight: Record<ProficiencyLevel, number> = {
  [ProficiencyLevel.EXPERT]: 4,
  [ProficiencyLevel.PROFICIENT]: 3,
  [ProficiencyLevel.INTERMEDIATE]: 2,
  [ProficiencyLevel.BEGINNER]: 1,
}

const getConflictingHostIds = async (
  startTime: Date,
  endTime: Date,
  excludeSessionId?: number
): Promise<Set<number>> => {
  const conflictingSessions = await prisma.session.findMany({
    where: {
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
    const { scriptId, startTime, endTime, limit, storeId } = req.body
    const effectiveStoreId = storeId ?? DEFAULT_STORE_ID

    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      select: { id: true, name: true, isActive: true, storeId: true },
    })

    if (!script) {
      throw new AppError('剧本不存在', 404)
    }
    if (!script.isActive) {
      throw new AppError('该剧本已被禁用', 400)
    }
    if (script.storeId !== effectiveStoreId) {
      throw new AppError('剧本不属于该门店', 400)
    }

    const store = await prisma.store.findUnique({
      where: { id: effectiveStoreId },
    })
    if (!store) {
      throw new AppError('门店不存在', 404)
    }

    const conflictingHostIds = await getConflictingHostIds(startTime, endTime)

    const activeHosts = await prisma.host.findMany({
      where: {
        isActive: true,
        id: { notIn: Array.from(conflictingHostIds) },
        stores: {
          some: {
            storeId: effectiveStoreId,
            isActive: true,
          },
        },
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
    const { storeIds, ...hostData } = req.body
    const effectiveStoreIds = storeIds ?? [DEFAULT_STORE_ID]

    const stores = await prisma.store.findMany({
      where: { id: { in: effectiveStoreIds } },
    })
    if (stores.length !== effectiveStoreIds.length) {
      const existingIds = stores.map(s => s.id)
      const missingIds = effectiveStoreIds.filter(id => !existingIds.includes(id))
      throw new AppError(`门店不存在: ${missingIds.join(', ')}`, 404)
    }

    const result = await prisma.$transaction(async (tx) => {
      const host = await tx.host.create({
        data: hostData,
      })

      await tx.hostStore.createMany({
        data: effectiveStoreIds.map(storeId => ({
          hostId: host.id,
          storeId,
        })),
      })

      return tx.host.findUnique({
        where: { id: host.id },
        include: {
          stores: {
            include: {
              store: { select: { id: true, name: true } },
            },
          },
        },
      })
    })

    res.sendSuccess(result, '主持人创建成功')
  } catch (error) {
    next(error)
  }
}

export const getHostList = async (req: GetHostListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (storeId !== undefined) {
      where.stores = {
        some: {
          storeId,
          isActive: true,
        },
      }
    }
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
          stores: {
            include: {
              store: { select: { id: true, name: true } },
            },
          },
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
    const { storeId } = req.query

    const host = await prisma.host.findUnique({
      where: { id },
      include: {
        stores: {
          include: {
            store: { select: { id: true, name: true } },
          },
        },
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
            store: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!host) {
      throw new AppError('主持人不存在', 404)
    }

    if (storeId !== undefined) {
      const isAssignedToStore = host.stores.some(s => s.storeId === storeId && s.isActive)
      if (!isAssignedToStore) {
        throw new AppError('主持人未分配到该门店', 404)
      }
    }

    res.sendSuccess(host)
  } catch (error) {
    next(error)
  }
}

export const updateHost = async (req: UpdateHostRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeIds, ...hostData } = req.body

    const existingHost = await prisma.host.findUnique({
      where: { id },
    })
    if (!existingHost) {
      throw new AppError('主持人不存在', 404)
    }

    let updatedHost
    if (storeIds !== undefined) {
      const stores = await prisma.store.findMany({
        where: { id: { in: storeIds } },
      })
      if (stores.length !== storeIds.length) {
        const existingIds = stores.map(s => s.id)
        const missingIds = storeIds.filter(id => !existingIds.includes(id))
        throw new AppError(`门店不存在: ${missingIds.join(', ')}`, 404)
      }

      updatedHost = await prisma.$transaction(async (tx) => {
        const host = await tx.host.update({
          where: { id },
          data: hostData,
        })

        await tx.hostStore.deleteMany({
          where: { hostId: id },
        })

        await tx.hostStore.createMany({
          data: storeIds.map(storeId => ({
            hostId: id,
            storeId,
          })),
        })

        return tx.host.findUnique({
          where: { id: host.id },
          include: {
            stores: {
              include: {
                store: { select: { id: true, name: true } },
              },
            },
          },
        })
      })
    } else {
      updatedHost = await prisma.host.update({
        where: { id },
        data: hostData,
        include: {
          stores: {
            include: {
              store: { select: { id: true, name: true } },
            },
          },
        },
      })
    }

    res.sendSuccess(updatedHost, '主持人更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteHost = async (req: GetHostByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingHost = await prisma.host.findUnique({
      where: { id },
    })
    if (!existingHost) {
      throw new AppError('主持人不存在', 404)
    }

    await prisma.host.delete({
      where: { id },
    })

    res.sendSuccess(null, '主持人删除成功')
  } catch (error) {
    next(error)
  }
}

export { getConflictingHostIds }
