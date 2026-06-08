import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  generateScheduleDrafts,
  createSchedulePlanWithDrafts,
  confirmSchedulePlan,
  deleteSchedulePlan,
  validateSchedulePlanForPublish,
  publishSchedulePlan,
} from './schedule.service'
import {
  generateScheduleSchema,
  schedulePlanQuerySchema,
  idParamSchema,
  confirmScheduleSchema,
  scheduleDraftUpdateSchema,
} from '../../common/schemas'
import { checkHostConflict, checkRoomConflict } from '../session/session.controller'

type GenerateScheduleRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof generateScheduleSchema>
>

type GetSchedulePlanListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof schedulePlanQuerySchema>,
  Record<string, never>
>

type GetSchedulePlanByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type ConfirmSchedulePlanRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof confirmScheduleSchema>
>

type DeleteSchedulePlanRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type UpdateDraftSessionRequest = TypedRequest<
  { planId: number; draftId: number },
  Record<string, never>,
  InferSchemaType<typeof scheduleDraftUpdateSchema>
>

type DeleteDraftSessionRequest = TypedRequest<
  { planId: number; draftId: number },
  Record<string, never>,
  Record<string, never>
>

type ValidatePublishRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type PublishSchedulePlanRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof confirmScheduleSchema>
>

const DEFAULT_STORE_ID = 1

export const generateSchedule = async (req: GenerateScheduleRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, startDate, endDate, name, remark, defaultPrice, sessionGapMinutes } = req.body
    const effectiveStoreId = storeId ?? DEFAULT_STORE_ID

    const { draftCandidates, unassignableSlots } = await generateScheduleDrafts({
      storeId: effectiveStoreId,
      startDate,
      endDate,
      name,
      remark,
      defaultPrice,
      sessionGapMinutes,
    })

    const schedulePlan = await createSchedulePlanWithDrafts(
      {
        storeId: effectiveStoreId,
        startDate,
        endDate,
        name,
        remark,
        defaultPrice,
        sessionGapMinutes,
      },
      draftCandidates,
      unassignableSlots
    )

    const totalSlots = draftCandidates.length + (unassignableSlots?.length || 0)
    const message = unassignableSlots && unassignableSlots.length > 0
      ? `排班方案生成成功，共生成 ${draftCandidates.length} 个场次草案，有 ${unassignableSlots.length} 个时间段因约束无法安排`
      : `排班方案生成成功，共生成 ${draftCandidates.length} 个场次草案`

    res.sendSuccess(schedulePlan, message)
  } catch (error) {
    next(error)
  }
}

export const getSchedulePlanList = async (req: GetSchedulePlanListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, storeId, status, startDate, endDate } = req.query

    const where: Record<string, unknown> = {}
    if (storeId !== undefined) where.storeId = storeId
    if (status) where.status = status
    if (startDate && endDate) {
      where.AND = [
        { startDate: { lte: endDate } },
        { endDate: { gte: startDate } },
      ]
    } else if (startDate) {
      where.endDate = { gte: startDate }
    } else if (endDate) {
      where.startDate = { lte: endDate }
    }

    const [plans, total] = await Promise.all([
      prisma.schedulePlan.findMany({
        where,
        include: {
          store: { select: { id: true, name: true } },
          _count: {
            select: { draftSessions: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.schedulePlan.count({ where }),
    ])

    const resultList = plans.map(plan => ({
      ...plan,
      draftSessionCount: plan._count.draftSessions,
      _count: undefined,
    }))

    res.sendSuccess(createPaginationResult(resultList, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getSchedulePlanById = async (req: GetSchedulePlanByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const plan = await prisma.schedulePlan.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true, businessStartTime: true, businessEndTime: true } },
        draftSessions: {
          include: {
            script: { select: { id: true, name: true, minPlayers: true, maxPlayers: true, durationMin: true, difficulty: true } },
            host: { select: { id: true, name: true, phone: true, avatar: true } },
            room: { select: { id: true, name: true, capacity: true, remark: true } },
          },
          orderBy: { startTime: 'asc' },
        },
        unassignableSlots: {
          include: {
            room: { select: { id: true, name: true, capacity: true, remark: true } },
          },
          orderBy: { startTime: 'asc' },
        },
      },
    })

    if (!plan) {
      throw new AppError('排班方案不存在', 404)
    }

    res.sendSuccess(plan)
  } catch (error) {
    next(error)
  }
}

export const confirmPlan = async (req: ConfirmSchedulePlanRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { operator } = req.body

    const result = await confirmSchedulePlan(id, operator)

    res.sendSuccess(result, `排班方案确认成功，共创建 ${result.createdSessions.length} 个正式场次`)
  } catch (error) {
    next(error)
  }
}

export const deletePlan = async (req: DeleteSchedulePlanRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    await deleteSchedulePlan(id)

    res.sendSuccess(null, '排班方案删除成功')
  } catch (error) {
    next(error)
  }
}

export const updateDraftSession = async (req: UpdateDraftSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { planId, draftId } = req.params
    const updateData = req.body

    const plan = await prisma.schedulePlan.findUnique({
      where: { id: planId },
    })

    if (!plan) {
      throw new AppError('排班方案不存在', 404)
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError(`排班方案状态为 ${plan.status}，无法修改草案场次`, 400)
    }

    const existingDraft = await prisma.scheduleDraftSession.findUnique({
      where: { id: draftId },
      include: { script: true, host: true, room: true },
    })

    if (!existingDraft || existingDraft.schedulePlanId !== planId) {
      throw new AppError('草案场次不存在', 404)
    }

    const finalScriptId = updateData.scriptId || existingDraft.scriptId
    const finalHostId = updateData.hostId || existingDraft.hostId
    const finalRoomId = updateData.roomId || existingDraft.roomId
    const finalStartTime = updateData.startTime || existingDraft.startTime
    const finalEndTime = updateData.endTime || existingDraft.endTime
    const finalMaxPlayers = updateData.maxPlayers || existingDraft.maxPlayers

    const [script, host, room] = await Promise.all([
      updateData.scriptId
        ? prisma.script.findUnique({ where: { id: updateData.scriptId } })
        : Promise.resolve(existingDraft.script),
      updateData.hostId
        ? prisma.host.findUnique({
            where: { id: updateData.hostId },
            include: { stores: { where: { storeId: plan.storeId } } },
          })
        : Promise.resolve(null),
      updateData.roomId
        ? prisma.room.findUnique({ where: { id: updateData.roomId } })
        : Promise.resolve(existingDraft.room),
    ])

    if (updateData.scriptId && !script) {
      throw new AppError('剧本不存在', 404)
    }
    if (updateData.scriptId && script && script.storeId !== plan.storeId) {
      throw new AppError('剧本不属于该门店', 400)
    }
    if (updateData.hostId && !host) {
      throw new AppError('主持人不存在', 404)
    }
    if (updateData.hostId && host && !host.isActive) {
      throw new AppError('主持人已被禁用', 400)
    }
    if (updateData.hostId && host && host.stores.length === 0) {
      throw new AppError('主持人未分配到该门店', 400)
    }
    if (updateData.roomId && !room) {
      throw new AppError('房间不存在', 404)
    }
    if (updateData.roomId && room && room.storeId !== plan.storeId) {
      throw new AppError('房间不属于该门店', 400)
    }
    if (updateData.roomId && room && !room.isActive) {
      throw new AppError('房间已被禁用', 400)
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

    let conflictInfo: string | undefined = undefined

    if (updateData.hostId || updateData.startTime || updateData.endTime) {
      try {
        await checkHostConflict(finalHostId, finalStartTime, finalEndTime)
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 409) {
          conflictInfo = error.message
        } else {
          throw error
        }
      }
    }

    if (!conflictInfo && (updateData.roomId || updateData.startTime || updateData.endTime)) {
      try {
        await checkRoomConflict(finalRoomId, finalStartTime, finalEndTime)
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 409) {
          conflictInfo = error.message
        } else {
          throw error
        }
      }
    }

    const updatedDraft = await prisma.scheduleDraftSession.update({
      where: { id: draftId },
      data: {
        ...updateData,
        conflictInfo,
      },
      include: {
        script: { select: { id: true, name: true, minPlayers: true, maxPlayers: true, durationMin: true } },
        host: { select: { id: true, name: true, phone: true } },
        room: { select: { id: true, name: true, capacity: true } },
      },
    })

    res.sendSuccess(updatedDraft, '草案场次更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteDraftSession = async (req: DeleteDraftSessionRequest, res: Response, next: NextFunction) => {
  try {
    const { planId, draftId } = req.params

    const plan = await prisma.schedulePlan.findUnique({
      where: { id: planId },
    })

    if (!plan) {
      throw new AppError('排班方案不存在', 404)
    }

    if (plan.status !== 'DRAFT') {
      throw new AppError(`排班方案状态为 ${plan.status}，无法删除草案场次`, 400)
    }

    const existingDraft = await prisma.scheduleDraftSession.findUnique({
      where: { id: draftId },
    })

    if (!existingDraft || existingDraft.schedulePlanId !== planId) {
      throw new AppError('草案场次不存在', 404)
    }

    await prisma.scheduleDraftSession.delete({
      where: { id: draftId },
    })

    res.sendSuccess(null, '草案场次删除成功')
  } catch (error) {
    next(error)
  }
}

export const validateForPublish = async (req: ValidatePublishRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const result = await validateSchedulePlanForPublish(id)

    if (result.isValid) {
      res.sendSuccess(result, '排班方案校验通过，可以发布')
    } else {
      res.sendError(
        `校验发现 ${result.totalConflictCount} 个冲突，请处理后再发布`,
        409,
        result
      )
    }
  } catch (error) {
    next(error)
  }
}

export const publishPlan = async (req: PublishSchedulePlanRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { operator } = req.body

    const result = await publishSchedulePlan(id, operator)

    res.sendSuccess(result, `排班方案发布成功，共创建 ${result.createdSessionCount} 个正式场次`)
  } catch (error) {
    next(error)
  }
}
