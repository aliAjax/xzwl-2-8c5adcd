import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { ProficiencyLevel, SessionStatus, Host } from '@prisma/client'
import { checkHostConflict, checkRoomConflict } from '../session/session.controller'
import { Decimal } from '@prisma/client/runtime/library'

export interface GenerateScheduleParams {
  storeId: number
  startDate: Date
  endDate: Date
  name: string
  remark?: string
  defaultPrice?: number
  sessionGapMinutes?: number
}

export interface DraftSessionCandidate {
  scriptId: number
  hostId: number
  roomId: number
  startTime: Date
  endTime: Date
  price: Decimal
  maxPlayers: number
  remark?: string
  conflictInfo?: string
  proficiencyLevel?: ProficiencyLevel
}

interface OccupiedSlot {
  hostId: number
  roomId: number
  startTime: Date
  endTime: Date
}

const proficiencyPriority: Record<ProficiencyLevel, number> = {
  EXPERT: 4,
  PROFICIENT: 3,
  INTERMEDIATE: 2,
  BEGINNER: 1,
}

const parseTimeString = (timeStr: string): { hour: number; minute: number } => {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

const checkConflictSilent = async (
  type: 'host' | 'room',
  id: number,
  startTime: Date,
  endTime: Date,
  occupiedSlots: OccupiedSlot[],
  excludeDraftId?: number
): Promise<string | null> => {
  try {
    if (type === 'host') {
      await checkHostConflict(id, startTime, endTime, excludeDraftId)
    } else {
      await checkRoomConflict(id, startTime, endTime, excludeDraftId)
    }
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      return error.message
    }
    throw error
  }

  const draftConflicts = occupiedSlots.filter(slot => {
    const slotId = type === 'host' ? slot.hostId : slot.roomId
    if (slotId !== id) return false
    return startTime < slot.endTime && endTime > slot.startTime
  })

  if (draftConflicts.length > 0) {
    const conflictInfo = draftConflicts
      .map(s => `草案冲突 (${s.startTime.toLocaleString()} - ${s.endTime.toLocaleString()})`)
      .join(', ')
    return `与排班草案内其他场次冲突：${conflictInfo}`
  }

  return null
}

const getProficiencyLevel = (
  proficiencies: { hostId: number; scriptId: number; level: ProficiencyLevel }[],
  hostId: number,
  scriptId: number
): ProficiencyLevel | undefined => {
  const prof = proficiencies.find(p => p.hostId === hostId && p.scriptId === scriptId)
  return prof?.level
}

interface HostWithConfig extends Host {
  maxDailySessions: number | null
}

const normalizeDate = (date: Date): Date => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const getHostDailySessionCount = (
  hostId: number,
  date: Date,
  occupiedSlots: OccupiedSlot[]
): number => {
  const normalizedDate = normalizeDate(date)
  return occupiedSlots.filter(slot => {
    if (slot.hostId !== hostId) return false
    const slotDate = normalizeDate(slot.startTime)
    return slotDate.getTime() === normalizedDate.getTime()
  }).length
}

const isHostRestDay = (
  hostId: number,
  date: Date,
  restDays: { hostId: number; restDate: Date }[]
): boolean => {
  const normalizedDate = normalizeDate(date)
  return restDays.some(rd => {
    if (rd.hostId !== hostId) return false
    const rdDate = normalizeDate(rd.restDate)
    return rdDate.getTime() === normalizedDate.getTime()
  })
}

const checkHostConstraint = (
  host: HostWithConfig,
  date: Date,
  occupiedSlots: OccupiedSlot[],
  restDays: { hostId: number; restDate: Date }[]
): string | null => {
  if (isHostRestDay(host.id, date, restDays)) {
    return `主持人 ${host.name} 当日为休息日`
  }

  if (host.maxDailySessions !== null) {
    const currentCount = getHostDailySessionCount(host.id, date, occupiedSlots)
    if (currentCount >= host.maxDailySessions) {
      return `主持人 ${host.name} 当日场次已达上限 (${host.maxDailySessions}场)`
    }
  }

  return null
}

export const generateScheduleDrafts = async (params: GenerateScheduleParams) => {
  const { storeId, startDate, endDate, name, remark, defaultPrice = 128, sessionGapMinutes = 30 } = params

  const [store, scripts, rooms, hostStores, existingSessions, proficiencies, restDays] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId, isActive: true },
    }),
    prisma.script.findMany({
      where: { storeId, isActive: true },
      include: { proficiencies: { include: { host: true } } },
    }),
    prisma.room.findMany({
      where: { storeId, isActive: true },
      orderBy: { capacity: 'desc' },
    }),
    prisma.hostStore.findMany({
      where: { storeId, isActive: true, host: { isActive: true } },
      include: { host: true },
    }),
    prisma.session.findMany({
      where: {
        storeId,
        status: { notIn: [SessionStatus.CANCELLED, SessionStatus.COMPLETED] },
        startTime: { gte: startDate },
        endTime: { lte: endDate },
      },
      select: { hostId: true, roomId: true, startTime: true, endTime: true },
    }),
    prisma.hostProficiency.findMany({
      where: {
        host: { stores: { some: { storeId, isActive: true } } },
        script: { storeId, isActive: true },
      },
    }),
    prisma.hostRestDay.findMany({
      where: {
        host: { stores: { some: { storeId, isActive: true } } },
        restDate: { gte: startDate, lte: endDate },
      },
      select: { hostId: true, restDate: true },
    }),
  ])

  if (!store) {
    throw new AppError('门店不存在或已禁用', 404)
  }
  if (scripts.length === 0) {
    throw new AppError('门店没有可用剧本', 400)
  }
  if (rooms.length === 0) {
    throw new AppError('门店没有可用房间', 400)
  }
  if (hostStores.length === 0) {
    throw new AppError('门店没有可用主持人', 400)
  }

  const { hour: startHour, minute: startMinute } = parseTimeString(store.businessStartTime || '10:00')
  const { hour: endHour, minute: endMinute } = parseTimeString(store.businessEndTime || '23:00')

  const hosts: HostWithConfig[] = hostStores.map(hs => ({
    ...hs.host,
    maxDailySessions: hs.host.maxDailySessions,
  }))
  const occupiedSlots: OccupiedSlot[] = [...existingSessions]
  const draftCandidates: DraftSessionCandidate[] = []
  const unassignableSlots: { startTime: Date; endTime: Date; roomId: number; reason: string }[] = []

  const currentDate = new Date(startDate)
  const endDateObj = new Date(endDate)

  while (currentDate <= endDateObj) {
    const dateStr = currentDate.toISOString().split('T')[0]

    for (const room of rooms) {
      let dayStartTime = new Date(`${dateStr}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`)
      const dayEndTime = new Date(`${dateStr}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`)

      while (dayStartTime < dayEndTime) {
        const suitableScripts = scripts.filter(script => script.minPlayers <= room.capacity)

        if (suitableScripts.length === 0) {
          break
        }

        let bestCandidate: DraftSessionCandidate | null = null
        let bestScore = -1
        let constraintViolations: string[] = []

        for (const script of suitableScripts) {
          const sessionEndTime = new Date(dayStartTime.getTime() + script.durationMin * 60 * 1000)

          if (sessionEndTime > dayEndTime) {
            continue
          }

          const availableHosts = hosts.filter(host => {
            const profLevel = getProficiencyLevel(proficiencies, host.id, script.id)
            return profLevel !== undefined
          })

          if (availableHosts.length === 0) {
            continue
          }

          for (const host of availableHosts) {
            const constraintError = checkHostConstraint(host, currentDate, occupiedSlots, restDays)
            if (constraintError) {
              if (!constraintViolations.includes(constraintError)) {
                constraintViolations.push(constraintError)
              }
              continue
            }

            const profLevel = getProficiencyLevel(proficiencies, host.id, script.id)!
            const maxPlayers = Math.min(script.maxPlayers, room.capacity)
            const price = new Decimal(defaultPrice)

            const hostConflict = await checkConflictSilent('host', host.id, dayStartTime, sessionEndTime, occupiedSlots)
            const roomConflict = await checkConflictSilent('room', room.id, dayStartTime, sessionEndTime, occupiedSlots)

            const conflictParts: string[] = []
            if (hostConflict) conflictParts.push(hostConflict)
            if (roomConflict) conflictParts.push(roomConflict)
            const conflictInfo = conflictParts.length > 0 ? conflictParts.join('; ') : undefined

            const proficiencyScore = proficiencyPriority[profLevel] * 10
            const roomFitScore = Math.floor((maxPlayers / room.capacity) * 10)
            const totalScore = proficiencyScore + roomFitScore

            const candidate: DraftSessionCandidate = {
              scriptId: script.id,
              hostId: host.id,
              roomId: room.id,
              startTime: new Date(dayStartTime),
              endTime: sessionEndTime,
              price,
              maxPlayers,
              remark,
              conflictInfo,
              proficiencyLevel: profLevel,
            }

            if (totalScore > bestScore) {
              bestScore = totalScore
              bestCandidate = candidate
            }
          }
        }

        if (bestCandidate) {
          if (!bestCandidate.conflictInfo) {
            occupiedSlots.push({
              hostId: bestCandidate.hostId,
              roomId: bestCandidate.roomId,
              startTime: bestCandidate.startTime,
              endTime: bestCandidate.endTime,
            })
          }
          draftCandidates.push(bestCandidate)
          dayStartTime = new Date(bestCandidate.endTime.getTime() + sessionGapMinutes * 60 * 1000)
        } else {
          const slotEndTime = new Date(dayStartTime.getTime() + 30 * 60 * 1000)
          const reason = constraintViolations.length > 0
            ? constraintViolations.join('; ')
            : '无合适主持人或剧本'
          unassignableSlots.push({
            startTime: new Date(dayStartTime),
            endTime: slotEndTime,
            roomId: room.id,
            reason,
          })
          dayStartTime = slotEndTime
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1)
  }

  return {
    store,
    scripts,
    rooms,
    hosts,
    draftCandidates,
    unassignableSlots,
  }
}

interface UnassignableSlot {
  startTime: Date
  endTime: Date
  roomId: number
  reason: string
}

export const createSchedulePlanWithDrafts = async (
  params: GenerateScheduleParams,
  candidates: DraftSessionCandidate[],
  unassignableSlots: UnassignableSlot[] = []
) => {
  const { storeId, startDate, endDate, name, remark } = params

  const result = await prisma.$transaction(async (tx) => {
    const schedulePlan = await tx.schedulePlan.create({
      data: {
        storeId,
        name,
        startDate,
        endDate,
        remark,
      },
    })

    if (candidates.length > 0) {
      await tx.scheduleDraftSession.createMany({
        data: candidates.map(candidate => ({
          schedulePlanId: schedulePlan.id,
          scriptId: candidate.scriptId,
          hostId: candidate.hostId,
          roomId: candidate.roomId,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          price: candidate.price,
          maxPlayers: candidate.maxPlayers,
          remark: candidate.remark,
          conflictInfo: candidate.conflictInfo,
          proficiencyLevel: candidate.proficiencyLevel,
        })),
      })
    }

    if (unassignableSlots.length > 0) {
      await tx.scheduleUnassignableSlot.createMany({
        data: unassignableSlots.map(slot => ({
          schedulePlanId: schedulePlan.id,
          roomId: slot.roomId,
          startTime: slot.startTime,
          endTime: slot.endTime,
          reason: slot.reason,
        })),
      })
    }

    const fullPlan = await tx.schedulePlan.findUnique({
      where: { id: schedulePlan.id },
      include: {
        store: { select: { id: true, name: true } },
        draftSessions: {
          include: {
            script: { select: { id: true, name: true, minPlayers: true, maxPlayers: true, durationMin: true } },
            host: { select: { id: true, name: true, phone: true } },
            room: { select: { id: true, name: true, capacity: true } },
          },
          orderBy: { startTime: 'asc' },
        },
        unassignableSlots: {
          include: {
            room: { select: { id: true, name: true, capacity: true } },
          },
          orderBy: { startTime: 'asc' },
        },
      },
    })

    return fullPlan
  })

  return result
}

const checkDraftInternalConflicts = (
  drafts: { id: number; hostId: number; roomId: number; startTime: Date; endTime: Date; script?: { name: string } }[]
): string[] => {
  const conflicts: string[] = []

  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      const draftA = drafts[i]
      const draftB = drafts[j]

      const hasOverlap = draftA.startTime < draftB.endTime && draftA.endTime > draftB.startTime

      if (!hasOverlap) continue

      if (draftA.hostId === draftB.hostId) {
        conflicts.push(
          `草案场次 ${draftA.id} 与 ${draftB.id} 主持人冲突 (主持人ID: ${draftA.hostId}, 时间: ${draftA.startTime.toLocaleString()}-${draftA.endTime.toLocaleString()})`
        )
      }

      if (draftA.roomId === draftB.roomId) {
        conflicts.push(
          `草案场次 ${draftA.id} 与 ${draftB.id} 房间冲突 (房间ID: ${draftA.roomId}, 时间: ${draftA.startTime.toLocaleString()}-${draftA.endTime.toLocaleString()})`
        )
      }
    }
  }

  return conflicts
}

export const confirmSchedulePlan = async (planId: number, operator?: string) => {
  const plan = await prisma.schedulePlan.findUnique({
    where: { id: planId },
    include: {
      draftSessions: {
        include: {
          script: true,
          host: true,
          room: true,
        },
      },
      store: true,
    },
  })

  if (!plan) {
    throw new AppError('排班方案不存在', 404)
  }

  if (plan.status !== 'DRAFT') {
    throw new AppError(`排班方案状态为 ${plan.status}，无法确认`, 400)
  }

  if (plan.draftSessions.length === 0) {
    throw new AppError('排班方案没有场次草案，无法确认', 400)
  }

  const sessionsWithConflicts = plan.draftSessions.filter(ds => ds.conflictInfo !== null && ds.conflictInfo !== undefined)
  if (sessionsWithConflicts.length > 0) {
    const conflictDetails = sessionsWithConflicts
      .map(ds => `场次 ${ds.id}: ${ds.conflictInfo}`)
      .join('; ')
    throw new AppError(`存在 ${sessionsWithConflicts.length} 个场次有冲突，请先处理后再确认：${conflictDetails}`, 409)
  }

  const internalConflicts = checkDraftInternalConflicts(plan.draftSessions)
  if (internalConflicts.length > 0) {
    const conflictDetails = internalConflicts.join('; ')
    throw new AppError(`草案内部存在 ${internalConflicts.length} 个冲突，请先处理后再确认：${conflictDetails}`, 409)
  }

  const result = await prisma.$transaction(async (tx) => {
    const occupiedSlots: { id: number; hostId: number; roomId: number; startTime: Date; endTime: Date }[] = []
    const createdSessions = []

    for (const draft of plan.draftSessions) {
      const [script, host, room] = await Promise.all([
        tx.script.findUnique({ where: { id: draft.scriptId } }),
        tx.host.findUnique({
          where: { id: draft.hostId },
          include: { stores: { where: { storeId: plan.storeId } } },
        }),
        tx.room.findUnique({ where: { id: draft.roomId } }),
      ])

      if (!script || script.storeId !== plan.storeId) {
        throw new AppError(`剧本 ${draft.scriptId} 不存在或不属于该门店`, 400)
      }
      if (!host || !host.isActive || host.stores.length === 0) {
        throw new AppError(`主持人 ${draft.hostId} 不存在、已禁用或未分配到该门店`, 400)
      }
      if (!room || !room.isActive || room.storeId !== plan.storeId) {
        throw new AppError(`房间 ${draft.roomId} 不存在、已禁用或不属于该门店`, 400)
      }
      if (draft.maxPlayers > script.maxPlayers || draft.maxPlayers < script.minPlayers) {
        throw new AppError(`场次人数必须在剧本人数范围内 (${script.minPlayers}-${script.maxPlayers})`, 400)
      }
      if (draft.maxPlayers > room.capacity) {
        throw new AppError(`场次人数不能超过房间容量 ${room.capacity}`, 400)
      }

      for (const slot of occupiedSlots) {
        const hasOverlap = draft.startTime < slot.endTime && draft.endTime > slot.startTime
        if (hasOverlap && draft.hostId === slot.hostId) {
          throw new AppError(
            `场次 "${script.name}" 与本方案已创建场次 ${slot.id} 主持人冲突`,
            409
          )
        }
        if (hasOverlap && draft.roomId === slot.roomId) {
          throw new AppError(
            `场次 "${script.name}" 与本方案已创建场次 ${slot.id} 房间冲突`,
            409
          )
        }
      }

      try {
        await checkHostConflict(draft.hostId, draft.startTime, draft.endTime)
        await checkRoomConflict(draft.roomId, draft.startTime, draft.endTime)
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(`场次 "${script.name}" 确认失败：${error.message}`, error.statusCode)
        }
        throw error
      }

      const session = await tx.session.create({
        data: {
          storeId: plan.storeId,
          scriptId: draft.scriptId,
          hostId: draft.hostId,
          roomId: draft.roomId,
          startTime: draft.startTime,
          endTime: draft.endTime,
          price: draft.price,
          maxPlayers: draft.maxPlayers,
          remark: draft.remark,
          status: SessionStatus.PENDING,
          currentPlayers: 0,
        },
        include: {
          store: { select: { id: true, name: true } },
          script: { select: { id: true, name: true } },
          host: { select: { id: true, name: true } },
          room: { select: { id: true, name: true, capacity: true } },
        },
      })

      occupiedSlots.push({
        id: session.id,
        hostId: draft.hostId,
        roomId: draft.roomId,
        startTime: draft.startTime,
        endTime: draft.endTime,
      })

      createdSessions.push(session)
    }

    await tx.schedulePlan.update({
      where: { id: planId },
      data: { status: 'CONFIRMED' },
    })

    return {
      plan,
      createdSessions,
    }
  })

  return result
}

export const deleteSchedulePlan = async (planId: number) => {
  const plan = await prisma.schedulePlan.findUnique({
    where: { id: planId },
  })

  if (!plan) {
    throw new AppError('排班方案不存在', 404)
  }

  if (plan.status === 'CONFIRMED') {
    throw new AppError('已确认的排班方案无法删除，请先删除相关场次', 400)
  }

  await prisma.$transaction(async (tx) => {
    await tx.scheduleDraftSession.deleteMany({
      where: { schedulePlanId: planId },
    })
    await tx.schedulePlan.delete({
      where: { id: planId },
    })
  })

  return true
}
