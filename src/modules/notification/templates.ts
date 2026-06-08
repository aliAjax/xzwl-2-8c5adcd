import { NotificationType, NotificationChannel } from '@prisma/client'
import { NotificationTemplate, NotificationTemplateParams } from './types'

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    code: 'SESSION_START_REMINDER',
    type: NotificationType.SESSION_START_REMINDER,
    name: '场次开场提醒',
    channel: NotificationChannel.SMS,
    contentTemplate: '【{{storeName}}】尊敬的{{recipientName}}，您预约的《{{scriptName}}》将于{{startTime}}开始，主持人：{{hostName}}，房间：{{roomName}}，共{{playerCount}}人。请准时到场，如有疑问请联系客服。',
    description: '场次开始前发送的提醒短信'
  },
  {
    code: 'SESSION_CANCELLED',
    type: NotificationType.SESSION_CANCELLED,
    name: '场次取消通知',
    channel: NotificationChannel.SMS,
    contentTemplate: '【{{storeName}}】尊敬的{{recipientName}}，您预约的《{{scriptName}}》（{{startTime}}）因故取消{{#if reason}}，原因：{{reason}}{{/if}}。如有疑问请联系客服，给您带来不便敬请谅解。',
    description: '场次取消时发送的通知短信'
  },
  {
    code: 'WAITLIST_CONFIRMED',
    type: NotificationType.WAITLIST_CONFIRMED,
    name: '候补确认通知',
    channel: NotificationChannel.SMS,
    contentTemplate: '【{{storeName}}】尊敬的{{recipientName}}，您候补的《{{scriptName}}》场次已有空位！时间：{{startTime}}，主持人：{{hostName}}，房间：{{roomName}}，共{{playerCount}}人。已自动为您确认预约，请准时到场。',
    description: '候补成功时发送的确认短信'
  },
  {
    code: 'MEMBERSHIP_BALANCE_CHANGE',
    type: NotificationType.MEMBERSHIP_BALANCE_CHANGE,
    name: '会员余额变动通知',
    channel: NotificationChannel.SMS,
    contentTemplate: '【{{storeName}}】尊敬的{{recipientName}}，您的会员账户发生{{typeText}}：{{amount}}元{{#if remark}}，备注：{{remark}}{{/if}}。当前余额：{{balanceAfter}}元。',
    description: '会员余额变动时发送的通知短信'
  }
]

const getTypeText = (type: string): string => {
  const typeMap: Record<string, string> = {
    RECHARGE: '充值',
    CONSUME: '消费',
    REFUND: '退款'
  }
  return typeMap[type] || type
}

const renderSimpleTemplate = (template: string, params: Record<string, unknown>): string => {
  let result = template
  
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = params[key]
    return value !== undefined && value !== null ? String(value) : match
  })
  
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
    const value = params[key]
    return value !== undefined && value !== null && value !== false ? content : ''
  })
  
  return result
}

export const renderTemplate = (
  templateCode: string,
  params: NotificationTemplateParams & { recipientName?: string }
): string => {
  const template = getTemplateByCode(templateCode)
  if (!template) {
    throw new Error(`Template not found: ${templateCode}`)
  }

  const templateParams: Record<string, unknown> = { ...params }

  if ('type' in params && params.type) {
    templateParams.typeText = getTypeText(params.type)
  }

  if (!templateParams.storeName) {
    templateParams.storeName = '剧本杀门店'
  }

  return renderSimpleTemplate(template.contentTemplate, templateParams)
}

export const getTemplateByCode = (code: string): NotificationTemplate | undefined => {
  return NOTIFICATION_TEMPLATES.find(t => t.code === code)
}

export const getTemplatesByType = (type: NotificationType): NotificationTemplate[] => {
  return NOTIFICATION_TEMPLATES.filter(t => t.type === type)
}
