import { NotificationType, NotificationStatus, NotificationChannel, Prisma } from '@prisma/client'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import {
  NotificationTaskCreateData,
  NotificationTaskFilter,
  NotificationTaskWithRelations,
  NotificationTemplateParams,
  NotificationBusinessEvent,
  NotificationEventContext,
  NotificationEventMetadata,
  EventType
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

const NOTIFICATION_EVENT_METADATA: Record<EventType, NotificationEventMetadata> = {
  SESSION_START_REMINDER: {
    templateCode: 'SESSION_START_REMINDER',
    notificationType: NotificationType.SESSION_START_REMINDER,
    defaultChannel: NotificationChannel.SMS,
    defaultMaxSendCount: 3
  },
  SESSION_CANCELLED: {
    templateCode: 'SESSION_CANCELLED',
    notificationType: NotificationType.SESSION_CANCELLED,
    defaultChannel: NotificationChannel.SMS,
    defaultMaxSendCount: 3
  },
  WAITLIST_CONFIRMED: {
    templateCode: 'WAITLIST_CONFIRMED',
    notificationType: NotificationType.WAITLIST_CONFIRMED,
    defaultChannel: NotificationChannel.SMS,
    defaultMaxSendCount: 3
  },
  MEMBERSHIP_BALANCE_CHANGE: {
    templateCode: 'MEMBERSHIP_BALANCE_CHANGE',
    notificationType: NotificationType.MEMBERSHIP_BALANCE_CHANGE,
    defaultChannel: NotificationChannel.SMS,
    defaultMaxSendCount: 3
  }
}

export const buildIdempotencyKeyFromEvent = (
  event: NotificationBusinessEvent
): string => {
  switch (event.type) {
    case 'SESSION_START_REMINDER':
      return generateIdempotencyKey(NotificationType.SESSION_START_REMINDER, `booking:${event.bookingId}`)
    case 'SESSION_CANCELLED':
      return generateIdempotencyKey(
        NotificationType.SESSION_CANCELLED,
        `session:${event.sessionId}:${event.entityType}:${event.entityId}`
      )
    case 'WAITLIST_CONFIRMED':
      return generateIdempotencyKey(NotificationType.WAITLIST_CONFIRMED, `waitlist:${event.waitlistId}`)
    case 'MEMBERSHIP_BALANCE_CHANGE':
      return generateIdempotencyKey(NotificationType.MEMBERSHIP_BALANCE_CHANGE, `transaction:${event.transactionId}`)
  }
}

const getEventMetadata = (eventType: EventType): NotificationEventMetadata => {
  return NOTIFICATION_EVENT_METADATA[eventType]
}

const getStoreName = async (
  client: Prisma.TransactionClient | typeof prisma,
  storeId?: number
): Promise<string | undefined> => {
  if (storeId === undefined) return undefined
  const store = await client.store.findUnique({
    where: { id: storeId },
    select: { name: true }
  })
  return store?.name
}

const executeCreateNotification = async <T extends EventType>(
  event: NotificationBusinessEvent & { type: T },
  context: NotificationEventContext<T>,
  client: Prisma.TransactionClient | typeof prisma,
  tx?: Prisma.TransactionClient
): Promise<NotificationTaskWithRelations | null> => {
  const metadata = getEventMetadata(event.type)
  const idempotencyKey = buildIdempotencyKeyFromEvent(event)

  const existingTask = await client.notificationTask.findUnique({
    where: { idempotencyKey },
    include: notificationTaskInclude
  })

  if (existingTask) {
    return existingTask as NotificationTaskWithRelations
  }

  const storeName = await getStoreName(client, context.storeId)

  const templateParams = {
    ...context.templateParams,
    storeName
  } as NotificationTemplateParams

  return createNotificationTask({
    type: metadata.notificationType,
    channel: context.channel || metadata.defaultChannel,
    recipient: context.recipient,
    templateCode: metadata.templateCode,
    templateParams,
    idempotencyKey,
    maxSendCount: context.maxSendCount || metadata.defaultMaxSendCount,
    relatedBookingId: context.relatedBookingId,
    relatedSessionId: context.relatedSessionId,
    relatedCustomerId: context.relatedCustomerId,
    relatedTransactionId: context.relatedTransactionId
  }, tx)
}

export const createNotificationForEvent = async <T extends EventType>(
  event: NotificationBusinessEvent & { type: T },
  context: NotificationEventContext<T>,
  tx?: Prisma.TransactionClient
): Promise<NotificationTaskWithRelations | null> => {
  const client = tx || prisma
  return executeCreateNotification(event, context, client, tx)
}

export const tryCreateNotificationForEvent = async <T extends EventType>(
  event: NotificationBusinessEvent & { type: T },
  context: NotificationEventContext<T>,
  tx?: Prisma.TransactionClient
): Promise<NotificationTaskWithRelations | null> => {
  try {
    return await createNotificationForEvent(event, context, tx)
  } catch (error) {
    console.error(`[Notification] Failed to create notification for event ${event.type}:`, error)
    return null
  }
}

export const tryCreateNotificationForEventAsync = async <T extends EventType>(
  event: NotificationBusinessEvent & { type: T },
  context: NotificationEventContext<T>,
  tx?: Prisma.TransactionClient
): Promise<void> => {
  try {
    if (tx) {
      await tryCreateNotificationForEvent(event, context, tx)
    } else {
      try {
        await prisma.$transaction(async (nestedTx) => {
          await executeCreateNotification(event, context, nestedTx, nestedTx)
        })
      } catch (nestedError) {
        console.error(`[Notification] Transaction failed for event ${event.type}:`, nestedError)
      }
    }
  } catch (error) {
    console.error(`[Notification] Failed to create notification for event ${event.type}:`, error)
  }
}

export const tryCreateNotificationForEventIsolated = async <T extends EventType>(
  event: NotificationBusinessEvent & { type: T },
  context: NotificationEventContext<T>
): Promise<NotificationTaskWithRelations | null> => {
  try {
    return await prisma.$transaction(async (isolatedTx) => {
      return await executeCreateNotification(event, context, isolatedTx, isolatedTx)
    })
  } catch (error) {
    console.error(`[Notification] Failed to create notification for event ${event.type}:`, error)
    return null
  }
}

export const tryCreateSessionStartReminderForBooking = async (
  bookingId: number
): Promise<NotificationTaskWithRelations | null> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: {
          include: { script: true, host: true, room: true }
        },
        customer: true
      }
    })

    if (!booking?.session || !booking.customer) return null

    return await tryCreateNotificationForEventIsolated(
      { type: 'SESSION_START_REMINDER', bookingId },
      {
        recipient: {
          name: booking.customer.name,
          phone: booking.customer.phone
        },
        templateParams: {
          sessionId: booking.session.id,
          scriptName: booking.session.script.name,
          hostName: booking.session.host?.name || '',
          roomName: booking.session.room?.name || '',
          startTime: booking.session.startTime.toLocaleString('zh-CN'),
          playerCount: booking.playerCount
        },
        storeId: booking.session.storeId,
        relatedBookingId: booking.id,
        relatedSessionId: booking.session.id,
        relatedCustomerId: booking.customerId
      }
    )
  } catch (error) {
    console.error(`[Notification] Failed to prepare session start reminder for booking ${bookingId}:`, error)
    return null
  }
}

export const tryCreateSessionCancelledForBooking = async (
  bookingId: number,
  tx?: Prisma.TransactionClient,
  options: { relatedBookingId?: number } = { relatedBookingId: bookingId }
): Promise<NotificationTaskWithRelations | null> => {
  try {
    const client = tx || prisma
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: {
          include: { script: true }
        },
        customer: true
      }
    })

    if (!booking?.session || !booking.customer) return null

    const event = { type: 'SESSION_CANCELLED' as const, sessionId: booking.session.id, entityType: 'booking' as const, entityId: booking.id }
    const context = {
      recipient: {
        name: booking.customer.name,
        phone: booking.customer.phone
      },
      templateParams: {
        sessionId: booking.session.id,
        scriptName: booking.session.script.name,
        startTime: booking.session.startTime.toLocaleString('zh-CN')
      },
      storeId: booking.session.storeId,
      relatedBookingId: options.relatedBookingId,
      relatedSessionId: booking.session.id,
      relatedCustomerId: booking.customerId
    }

    if (tx) {
      return await tryCreateNotificationForEvent(event, context, tx)
    }

    return await tryCreateNotificationForEventIsolated(
      event,
      context
    )
  } catch (error) {
    console.error(`[Notification] Failed to prepare session cancellation for booking ${bookingId}:`, error)
    return null
  }
}

export const tryCreateSessionCancelledForParticipants = async (
  sessionId: number,
  participants: {
    bookings?: Array<{
      id: number
      customerId: number
      customer?: { name: string; phone: string } | null
    }>
    waitlists?: Array<{
      id: number
      customerId: number
      customer?: { name: string; phone: string } | null
    }>
  }
): Promise<void> => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { script: true }
    })

    if (!session) return

    const templateParams = {
      sessionId,
      scriptName: session.script.name,
      startTime: session.startTime.toLocaleString('zh-CN')
    }

    for (const booking of participants.bookings || []) {
      if (!booking.customer) continue
      await tryCreateNotificationForEventIsolated(
        { type: 'SESSION_CANCELLED', sessionId, entityType: 'booking', entityId: booking.id },
        {
          recipient: {
            name: booking.customer.name,
            phone: booking.customer.phone
          },
          templateParams,
          storeId: session.storeId,
          relatedBookingId: booking.id,
          relatedSessionId: sessionId,
          relatedCustomerId: booking.customerId
        }
      )
    }

    for (const waitlist of participants.waitlists || []) {
      if (!waitlist.customer) continue
      await tryCreateNotificationForEventIsolated(
        { type: 'SESSION_CANCELLED', sessionId, entityType: 'waitlist', entityId: waitlist.id },
        {
          recipient: {
            name: waitlist.customer.name,
            phone: waitlist.customer.phone
          },
          templateParams,
          storeId: session.storeId,
          relatedSessionId: sessionId,
          relatedCustomerId: waitlist.customerId
        }
      )
    }
  } catch (error) {
    console.error(`[Notification] Failed to prepare session cancellation notifications for session ${sessionId}:`, error)
  }
}

export const tryCreateWaitlistConfirmedNotification = async (
  tx: Prisma.TransactionClient,
  waitlistId: number,
  bookingId: number
): Promise<NotificationTaskWithRelations | null> => {
  try {
    const waitlist = await tx.waitlist.findUnique({
      where: { id: waitlistId },
      include: {
        customer: true,
        session: {
          include: { script: true, host: true, room: true }
        }
      }
    })

    if (!waitlist?.customer || !waitlist.session) return null

    return await tryCreateNotificationForEvent(
      { type: 'WAITLIST_CONFIRMED', waitlistId },
      {
        recipient: {
          name: waitlist.customer.name ?? '',
          phone: waitlist.customer.phone
        },
        templateParams: {
          waitlistId,
          bookingId,
          scriptName: waitlist.session.script.name,
          hostName: waitlist.session.host?.name || '',
          roomName: waitlist.session.room?.name || '',
          startTime: waitlist.session.startTime.toLocaleString('zh-CN'),
          playerCount: waitlist.playerCount
        },
        storeId: waitlist.session.storeId,
        relatedBookingId: bookingId,
        relatedSessionId: waitlist.sessionId,
        relatedCustomerId: waitlist.customerId
      },
      tx
    )
  } catch (error) {
    console.error(`[Notification] Failed to prepare waitlist confirmation for waitlist ${waitlistId}:`, error)
    return null
  }
}

export const tryCreateMembershipBalanceChangeNotification = async (
  tx: Prisma.TransactionClient,
  transactionId: number
): Promise<NotificationTaskWithRelations | null> => {
  try {
    const transaction = await tx.membershipTransaction.findUnique({
      where: { id: transactionId },
      include: {
        account: {
          include: {
            customer: true
          }
        }
      }
    })

    const customer = transaction?.account.customer
    if (!transaction || !customer) return null

    return await tryCreateNotificationForEvent(
      { type: 'MEMBERSHIP_BALANCE_CHANGE', transactionId },
      {
        recipient: {
          name: customer.name,
          phone: customer.phone
        },
        templateParams: {
          transactionId,
          type: transaction.type,
          amount: transaction.amount.toString(),
          balanceAfter: transaction.balanceAfter.toString(),
          remark: transaction.remark || undefined
        },
        storeId: transaction.storeId || undefined,
        relatedCustomerId: transaction.account.customerId,
        relatedTransactionId: transaction.id,
        relatedBookingId: transaction.relatedBookingId || undefined
      },
      tx
    )
  } catch (error) {
    console.error(`[Notification] Failed to prepare membership balance notification for transaction ${transactionId}:`, error)
    return null
  }
}
