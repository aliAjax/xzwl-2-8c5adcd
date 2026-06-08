import { NotificationType, NotificationStatus, NotificationChannel, Prisma } from '@prisma/client'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import {
  NotificationTaskCreateData,
  NotificationTaskFilter,
  NotificationTaskWithRelations,
  NotificationTemplateParams
} from './types'
import { renderTemplate } from './templates'
import { getNotificationSender } from './adapter'

export const generateIdempotencyKey = (
  type: NotificationType,
  businessId: string | number
): string => {
  return `${type}:${businessId}`
}

const notificationTaskInclude = {
  relatedBooking: {
    include: {
      session: {
        include: {
          script: true,
          host: true,
          room: true
        }
      },
      customer: true
    }
  },
  relatedSession: {
    include: {
      script: true,
      host: true,
      room: true
    }
  },
  relatedCustomer: true,
  relatedTransaction: true
}

export const createNotificationTask = async (
  data: NotificationTaskCreateData,
  tx?: Prisma.TransactionClient
): Promise<NotificationTaskWithRelations> => {
  const client = tx || prisma

  const existingTask = await client.notificationTask.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
    include: notificationTaskInclude
  })

  if (existingTask) {
    return existingTask as NotificationTaskWithRelations
  }

  const task = await client.notificationTask.create({
    data: {
      type: data.type,
      channel: data.channel || NotificationChannel.SMS,
      status: NotificationStatus.PENDING,
      idempotencyKey: data.idempotencyKey,
      recipientPhone: data.recipient.phone,
      recipientName: data.recipient.name,
      templateCode: data.templateCode,
      templateParams: data.templateParams as unknown as Prisma.JsonObject,
      maxSendCount: data.maxSendCount || 3,
      relatedBookingId: data.relatedBookingId,
      relatedSessionId: data.relatedSessionId,
      relatedCustomerId: data.relatedCustomerId,
      relatedTransactionId: data.relatedTransactionId
    },
    include: notificationTaskInclude
  })

  return task as NotificationTaskWithRelations
}

export const getNotificationTaskById = async (
  id: number,
  storeId?: number
): Promise<NotificationTaskWithRelations | null> => {
  const task = await prisma.notificationTask.findUnique({
    where: { id },
    include: notificationTaskInclude
  })

  if (task && storeId !== undefined) {
    const taskStoreId = task.relatedSession?.storeId ?? task.relatedBooking?.session?.storeId
    if (taskStoreId !== storeId) {
      throw new AppError('通知任务不属于该门店', 404)
    }
  }

  return task as NotificationTaskWithRelations | null
}

export const getNotificationTaskList = async (
  page: number,
  pageSize: number,
  filter: NotificationTaskFilter
) => {
  const where: Prisma.NotificationTaskWhereInput = {}

  if (filter.type) where.type = filter.type
  if (filter.status) where.status = filter.status
  if (filter.channel) where.channel = filter.channel
  if (filter.recipientPhone) where.recipientPhone = { contains: filter.recipientPhone }
  if (filter.relatedCustomerId) where.relatedCustomerId = filter.relatedCustomerId
  if (filter.relatedSessionId) where.relatedSessionId = filter.relatedSessionId
  if (filter.startDate) where.createdAt = { ...where.createdAt as object, gte: filter.startDate }
  if (filter.endDate) where.createdAt = { ...where.createdAt as object, lte: filter.endDate }
  if (filter.storeId) {
    where.OR = [
      { relatedSession: { storeId: filter.storeId } },
      { relatedBooking: { session: { storeId: filter.storeId } } }
    ]
  }

  const [tasks, total] = await Promise.all([
    prisma.notificationTask.findMany({
      where,
      include: notificationTaskInclude,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.notificationTask.count({ where })
  ])

  return createPaginationResult(
    tasks as NotificationTaskWithRelations[],
    total,
    page,
    pageSize
  )
}

const calculateRetryAfter = (sendCount: number): Date => {
  const delayMinutes = Math.pow(2, sendCount) * 5
  const retryAfter = new Date()
  retryAfter.setMinutes(retryAfter.getMinutes() + delayMinutes)
  return retryAfter
}

export const processNotificationTask = async (
  id: number
): Promise<NotificationTaskWithRelations> => {
  const task = await getNotificationTaskById(id)
  if (!task) {
    throw new AppError('通知任务不存在', 404)
  }

  if (task.status === NotificationStatus.SENT) {
    return task
  }

  if (task.status === NotificationStatus.CANCELLED) {
    throw new AppError('通知任务已取消，无法发送', 400)
  }

  if (task.sendCount >= task.maxSendCount) {
    throw new AppError('通知任务已达到最大发送次数', 400)
  }

  return await prisma.$transaction(async (tx) => {
    const lockedTask = await tx.notificationTask.update({
      where: { id },
      data: {
        status: NotificationStatus.RETRYING,
        sendCount: { increment: 1 },
        lastSendAt: new Date()
      },
      include: notificationTaskInclude
    })

    try {
      const templateParams = lockedTask.templateParams as unknown as NotificationTemplateParams & { recipientName?: string }
      const content = renderTemplate(lockedTask.templateCode, {
        ...templateParams,
        recipientName: lockedTask.recipientName || undefined
      })

      const sender = getNotificationSender(lockedTask.channel)
      const result = await sender.send(
        { name: lockedTask.recipientName || '', phone: lockedTask.recipientPhone },
        content,
        lockedTask.templateCode,
        templateParams as unknown as Record<string, unknown>
      )

      if (result.success) {
        const updatedTask = await tx.notificationTask.update({
          where: { id },
          data: {
            status: NotificationStatus.SENT,
            content,
            sentAt: new Date(),
            failedReason: null,
            retryAfter: null
          },
          include: notificationTaskInclude
        })
        return updatedTask as NotificationTaskWithRelations
      } else {
        const newSendCount = lockedTask.sendCount
        const shouldRetry = newSendCount < lockedTask.maxSendCount

        const updatedTask = await tx.notificationTask.update({
          where: { id },
          data: {
            status: shouldRetry ? NotificationStatus.FAILED : NotificationStatus.FAILED,
            content,
            failedReason: result.error || '发送失败',
            retryAfter: shouldRetry ? calculateRetryAfter(newSendCount) : null
          },
          include: notificationTaskInclude
        })
        return updatedTask as NotificationTaskWithRelations
      }
    } catch (error) {
      const newSendCount = lockedTask.sendCount
      const shouldRetry = newSendCount < lockedTask.maxSendCount

      const updatedTask = await tx.notificationTask.update({
        where: { id },
        data: {
          status: shouldRetry ? NotificationStatus.FAILED : NotificationStatus.FAILED,
          failedReason: error instanceof Error ? error.message : '发送失败',
          retryAfter: shouldRetry ? calculateRetryAfter(newSendCount) : null
        },
        include: notificationTaskInclude
      })
      return updatedTask as NotificationTaskWithRelations
    }
  })
}

export const retryNotificationTask = async (
  id: number
): Promise<NotificationTaskWithRelations> => {
  const task = await getNotificationTaskById(id)
  if (!task) {
    throw new AppError('通知任务不存在', 404)
  }

  if (task.status === NotificationStatus.SENT) {
    throw new AppError('通知已发送成功，无需重试', 400)
  }

  if (task.status === NotificationStatus.CANCELLED) {
    throw new AppError('通知任务已取消，无法重试', 400)
  }

  const updatedTask = await prisma.notificationTask.update({
    where: { id },
    data: {
      status: NotificationStatus.PENDING,
      retryAfter: null,
      failedReason: null
    },
    include: notificationTaskInclude
  })

  return processNotificationTask(id)
}

export const processPendingNotifications = async (
  batchSize: number = 10
): Promise<{ processed: number; success: number; failed: number }> => {
  const now = new Date()

  const pendingTasks = await prisma.notificationTask.findMany({
    where: {
      OR: [
        { status: NotificationStatus.PENDING },
        {
          status: NotificationStatus.FAILED,
          retryAfter: { lte: now }
        }
      ],
      sendCount: { lt: prisma.notificationTask.fields.maxSendCount }
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true }
  })

  let success = 0
  let failed = 0

  for (const task of pendingTasks) {
    try {
      const result = await processNotificationTask(task.id)
      if (result.status === NotificationStatus.SENT) {
        success++
      } else {
        failed++
      }
    } catch (error) {
      failed++
    }
  }

  return {
    processed: pendingTasks.length,
    success,
    failed
  }
}

export const cancelNotificationTask = async (
  id: number
): Promise<NotificationTaskWithRelations> => {
  const task = await getNotificationTaskById(id)
  if (!task) {
    throw new AppError('通知任务不存在', 404)
  }

  if (task.status === NotificationStatus.SENT) {
    throw new AppError('通知已发送，无法取消', 400)
  }

  if (task.status === NotificationStatus.CANCELLED) {
    return task
  }

  const updatedTask = await prisma.notificationTask.update({
    where: { id },
    data: {
      status: NotificationStatus.CANCELLED,
      failedReason: '手动取消',
      retryAfter: null
    },
    include: notificationTaskInclude
  })

  return updatedTask as NotificationTaskWithRelations
}
