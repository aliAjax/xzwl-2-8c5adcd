import { NotificationType, NotificationChannel, NotificationStatus, Prisma } from '@prisma/client'

export type NotificationBusinessEvent =
  | { type: 'SESSION_START_REMINDER'; bookingId: number }
  | { type: 'SESSION_CANCELLED'; sessionId: number; entityType: 'booking' | 'waitlist'; entityId: number }
  | { type: 'WAITLIST_CONFIRMED'; waitlistId: number }
  | { type: 'MEMBERSHIP_BALANCE_CHANGE'; transactionId: number }

export interface RecipientSnapshot {
  name: string
  phone: string
}

export interface SessionStartReminderParams {
  sessionId: number
  scriptName: string
  hostName: string
  roomName: string
  startTime: string
  playerCount: number
  storeName?: string
}

export interface SessionCancelledParams {
  sessionId: number
  scriptName: string
  startTime: string
  reason?: string
  storeName?: string
}

export interface WaitlistConfirmedParams {
  waitlistId: number
  bookingId: number
  scriptName: string
  hostName: string
  roomName: string
  startTime: string
  playerCount: number
  storeName?: string
}

export interface MembershipBalanceChangeParams {
  transactionId: number
  type: 'RECHARGE' | 'CONSUME' | 'REFUND'
  amount: string
  balanceAfter: string
  remark?: string
  storeName?: string
}

export type NotificationTemplateParams =
  | SessionStartReminderParams
  | SessionCancelledParams
  | WaitlistConfirmedParams
  | MembershipBalanceChangeParams

export interface NotificationTemplate {
  code: string
  type: NotificationType
  name: string
  channel: NotificationChannel
  contentTemplate: string
  description?: string
}

export interface SendNotificationResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface NotificationSender {
  send(
    recipient: RecipientSnapshot,
    content: string,
    templateCode: string,
    params: Record<string, unknown>
  ): Promise<SendNotificationResult>

  getChannel(): NotificationChannel
}

export interface NotificationTaskCreateData {
  type: NotificationType
  channel?: NotificationChannel
  recipient: RecipientSnapshot
  templateCode: string
  templateParams: NotificationTemplateParams
  idempotencyKey: string
  maxSendCount?: number
  relatedBookingId?: number
  relatedSessionId?: number
  relatedCustomerId?: number
  relatedTransactionId?: number
}

export interface NotificationEventContext {
  recipient: RecipientSnapshot
  templateParams: Omit<NotificationTemplateParams, 'storeName'>
  templateCode: string
  storeId?: number
  relatedBookingId?: number
  relatedSessionId?: number
  relatedCustomerId?: number
  relatedTransactionId?: number
  maxSendCount?: number
  channel?: NotificationChannel
}

export interface NotificationTaskFilter {
  type?: NotificationType
  status?: NotificationStatus
  channel?: NotificationChannel
  recipientPhone?: string
  relatedCustomerId?: number
  relatedSessionId?: number
  startDate?: Date
  endDate?: Date
  storeId?: number
}

export interface NotificationTaskWithRelations extends Prisma.NotificationTaskGetPayload<{
  include: {
    relatedBooking: {
      include: {
        session: {
          include: {
            script: true
            host: true
            room: true
          }
        }
        customer: true
      }
    }
    relatedSession: {
      include: {
        script: true
        host: true
        room: true
      }
    }
    relatedCustomer: true
    relatedTransaction: true
  }
}> {}
