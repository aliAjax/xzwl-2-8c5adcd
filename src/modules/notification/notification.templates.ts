import { NotificationTaskType, NotificationChannel, MembershipTransactionType } from '@prisma/client'

export interface NotificationTemplate {
  code: string
  type: NotificationTaskType
  channel: NotificationChannel
  name: string
  contentTemplate: string
  params: string[]
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  SESSION_OPENING_REMINDER_SMS: {
    code: 'SESSION_OPENING_REMINDER_SMS',
    type: NotificationTaskType.SESSION_OPENING_REMINDER,
    channel: NotificationChannel.SMS,
    name: '场次开场提醒',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您预约的《{scriptName}》将于{startTime}在{roomName}开场，请准时到场。主持人：{hostName}',
    params: ['storeName', 'customerName', 'scriptName', 'startTime', 'roomName', 'hostName'],
  },
  SESSION_CANCELLATION_SMS: {
    code: 'SESSION_CANCELLATION_SMS',
    type: NotificationTaskType.SESSION_CANCELLATION,
    channel: NotificationChannel.SMS,
    name: '场次取消通知',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您预约的《{scriptName}》{startTime}场次已取消，给您带来不便敬请谅解。',
    params: ['storeName', 'customerName', 'scriptName', 'startTime'],
  },
  WAITLIST_CONFIRMATION_SMS: {
    code: 'WAITLIST_CONFIRMATION_SMS',
    type: NotificationTaskType.WAITLIST_CONFIRMATION,
    channel: NotificationChannel.SMS,
    name: '候补转正通知',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您候补的《{scriptName}》{startTime}场次已有空位，已为您确认预约。',
    params: ['storeName', 'customerName', 'scriptName', 'startTime'],
  },
  BALANCE_CHANGE_RECHARGE_SMS: {
    code: 'BALANCE_CHANGE_RECHARGE_SMS',
    type: NotificationTaskType.BALANCE_CHANGE,
    channel: NotificationChannel.SMS,
    name: '会员充值通知',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您的会员账户已充值{amount}元，当前余额{balanceAfter}元。',
    params: ['storeName', 'customerName', 'amount', 'balanceAfter'],
  },
  BALANCE_CHANGE_CONSUME_SMS: {
    code: 'BALANCE_CHANGE_CONSUME_SMS',
    type: NotificationTaskType.BALANCE_CHANGE,
    channel: NotificationChannel.SMS,
    name: '会员消费通知',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您的会员账户已消费{amount}元，当前余额{balanceAfter}元。',
    params: ['storeName', 'customerName', 'amount', 'balanceAfter'],
  },
  BALANCE_CHANGE_REFUND_SMS: {
    code: 'BALANCE_CHANGE_REFUND_SMS',
    type: NotificationTaskType.BALANCE_CHANGE,
    channel: NotificationChannel.SMS,
    name: '会员退款通知',
    contentTemplate: '【{storeName}】尊敬的{customerName}，您的会员账户已退款{amount}元，当前余额{balanceAfter}元。',
    params: ['storeName', 'customerName', 'amount', 'balanceAfter'],
  },
}

export const renderTemplate = (
  templateCode: string,
  params: Record<string, string | number>
): string => {
  const template = NOTIFICATION_TEMPLATES[templateCode]
  if (!template) {
    throw new Error(`Template not found: ${templateCode}`)
  }

  let content = template.contentTemplate
  for (const key of template.params) {
    const value = params[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing parameter: ${key} for template: ${templateCode}`)
    }
    content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
  }

  return content
}

export const getTemplateCode = (
  type: NotificationTaskType,
  channel: NotificationChannel,
  subType?: MembershipTransactionType
): string => {
  let templateCode: string

  if (type === NotificationTaskType.BALANCE_CHANGE && subType) {
    const subTypeMap: Record<MembershipTransactionType, string> = {
      [MembershipTransactionType.RECHARGE]: 'RECHARGE',
      [MembershipTransactionType.CONSUME]: 'CONSUME',
      [MembershipTransactionType.REFUND]: 'REFUND',
    }
    templateCode = `${type}_${subTypeMap[subType]}_${channel}`
  } else {
    templateCode = `${type}_${channel}`
  }

  if (!NOTIFICATION_TEMPLATES[templateCode]) {
    throw new Error(`Template not found for type: ${type}, channel: ${channel}, subType: ${subType}`)
  }

  return templateCode
}
