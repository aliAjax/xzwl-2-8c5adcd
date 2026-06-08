import { NotificationChannel } from '@prisma/client'
import { NotificationSender, RecipientSnapshot, SendNotificationResult } from './types'

export abstract class AbstractNotificationSender implements NotificationSender {
  abstract getChannel(): NotificationChannel

  abstract send(
    recipient: RecipientSnapshot,
    content: string,
    templateCode: string,
    params: Record<string, unknown>
  ): Promise<SendNotificationResult>
}

export class MockNotificationSender extends AbstractNotificationSender {
  private channel: NotificationChannel

  constructor(channel: NotificationChannel = NotificationChannel.SMS) {
    super()
    this.channel = channel
  }

  getChannel(): NotificationChannel {
    return this.channel
  }

  async send(
    recipient: RecipientSnapshot,
    content: string,
    templateCode: string,
    params: Record<string, unknown>
  ): Promise<SendNotificationResult> {
    console.log('[MockNotificationSender] 发送通知:', {
      channel: this.channel,
      recipient,
      templateCode,
      content,
      params
    })

    return {
      success: true,
      messageId: `mock-${Date.now()}`
    }
  }
}

const senderRegistry: Map<NotificationChannel, AbstractNotificationSender> = new Map()

senderRegistry.set(NotificationChannel.SMS, new MockNotificationSender(NotificationChannel.SMS))
senderRegistry.set(NotificationChannel.EMAIL, new MockNotificationSender(NotificationChannel.EMAIL))
senderRegistry.set(NotificationChannel.WECHAT, new MockNotificationSender(NotificationChannel.WECHAT))

export const getNotificationSender = (
  channel: NotificationChannel
): AbstractNotificationSender => {
  const sender = senderRegistry.get(channel)
  if (!sender) {
    throw new Error(`No notification sender found for channel: ${channel}`)
  }
  return sender
}

export const registerNotificationSender = (
  channel: NotificationChannel,
  sender: AbstractNotificationSender
): void => {
  senderRegistry.set(channel, sender)
}
