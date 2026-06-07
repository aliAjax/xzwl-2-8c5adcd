import { z } from 'zod'
import { Difficulty, ProficiencyLevel, SessionStatus, BookingStatus, WaitlistStatus, MembershipTransactionType, MembershipTransactionStatus } from '@prisma/client'

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  keyword: z.string().optional(),
  storeId: z.coerce.number().int().positive().optional(),
})

export const storeSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }).optional(),
  isActive: z.boolean().optional().default(true),
})

export const storeUpdateSchema = storeSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const hostAssignStoreSchema = z.object({
  hostId: z.number().int().positive(),
  storeIds: z.array(z.number().int().positive()).min(1),
})

export const scriptSchema = z.object({
  storeId: z.coerce.number().int().positive().optional().default(1),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  durationMin: z.number().int().positive(),
  difficulty: z.nativeEnum(Difficulty),
  coverImage: z.string().url().optional(),
  isActive: z.boolean().optional().default(true),
})

export const scriptUpdateSchema = scriptSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const hostSchema = z.object({
  storeIds: z.array(z.coerce.number().int().positive()).optional(),
  name: z.string().min(1).max(50),
  phone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }),
  avatar: z.string().url().optional(),
  isActive: z.boolean().optional().default(true),
})

export const hostUpdateSchema = hostSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const roomSchema = z.object({
  storeId: z.coerce.number().int().positive().optional().default(1),
  name: z.string().min(1).max(50),
  capacity: z.number().int().positive(),
  isActive: z.boolean().optional().default(true),
  remark: z.string().optional(),
})

export const roomUpdateSchema = roomSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const roomQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  isActive: z.coerce.boolean().optional(),
  keyword: z.string().optional(),
  storeId: z.coerce.number().int().positive().optional(),
})

export const proficiencySchema = z.object({
  hostId: z.number().int().positive(),
  scriptId: z.number().int().positive(),
  level: z.nativeEnum(ProficiencyLevel),
})

export const proficiencyUpdateSchema = z.object({
  level: z.nativeEnum(ProficiencyLevel),
})

export const sessionSchema = z.object({
  storeId: z.coerce.number().int().positive().optional().default(1),
  scriptId: z.number().int().positive(),
  hostId: z.number().int().positive(),
  roomId: z.number().int().positive(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  status: z.nativeEnum(SessionStatus).optional().default(SessionStatus.PENDING),
  price: z.coerce.number().positive(),
  maxPlayers: z.number().int().positive(),
  remark: z.string().optional(),
}).refine(data => data.endTime > data.startTime, {
  message: '结束时间必须晚于开始时间',
  path: ['endTime'],
})

export const sessionUpdateSchema = z.object({
  scriptId: z.number().int().positive().optional(),
  hostId: z.number().int().positive().optional(),
  roomId: z.number().int().positive().optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  status: z.nativeEnum(SessionStatus).optional(),
  price: z.coerce.number().positive().optional(),
  maxPlayers: z.number().int().positive().optional(),
  remark: z.string().optional(),
}).refine(data => {
  if (data.startTime && data.endTime) {
    return data.endTime > data.startTime
  }
  return true
}, {
  message: '结束时间必须晚于开始时间',
  path: ['endTime'],
})

export const sessionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  scriptId: z.coerce.number().int().positive().optional(),
  hostId: z.coerce.number().int().positive().optional(),
  roomId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(SessionStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

export const availableSessionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  scriptId: z.coerce.number().int().positive().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  playerCount: z.coerce.number().int().positive().optional(),
  difficulty: z.nativeEnum(Difficulty).optional(),
  keyword: z.string().optional(),
})

export const bookingSchema = z.object({
  sessionId: z.number().int().positive(),
  customerName: z.string().min(1).max(50),
  customerPhone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }),
  playerCount: z.number().int().positive(),
  status: z.nativeEnum(BookingStatus).optional().default(BookingStatus.PENDING),
  remark: z.string().optional(),
  useMembership: z.boolean().optional().default(false),
  membershipAmount: z.coerce.number().positive().optional(),
  operator: z.string().optional(),
})

export const bookingUpdateSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  playerCount: z.number().int().positive().optional(),
  remark: z.string().optional(),
  useMembership: z.boolean().optional().default(false),
  membershipAmount: z.coerce.number().positive().optional(),
  operator: z.string().optional(),
})

export const bookingQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(BookingStatus).optional(),
  keyword: z.string().optional(),
})

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional().default(30),
  storeId: z.coerce.number().int().positive().optional(),
  scriptId: z.coerce.number().int().positive().optional(),
})

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  keyword: z.string().optional(),
})

export const customerUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }).optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

const importScriptSchema = z.object({
  type: z.literal('script'),
  data: scriptSchema,
})

const importHostSchema = z.object({
  type: z.literal('host'),
  data: hostSchema,
})

export const importProficiencyDataSchema = z.object({
  hostId: z.number().int().positive().optional(),
  hostPhone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }).optional(),
  scriptId: z.number().int().positive().optional(),
  scriptName: z.string().min(1).max(100).optional(),
  level: z.nativeEnum(ProficiencyLevel),
}).refine(
  data => (data.hostId !== undefined || data.hostPhone !== undefined) && 
          (data.scriptId !== undefined || data.scriptName !== undefined),
  { message: '必须提供 hostId 或 hostPhone，以及 scriptId 或 scriptName' }
)

const importProficiencySchema = z.object({
  type: z.literal('proficiency'),
  data: importProficiencyDataSchema,
})

export const importItemSchema = z.discriminatedUnion('type', [
  importScriptSchema,
  importHostSchema,
  importProficiencySchema,
])

export const importBatchSchema = z.array(importItemSchema).min(1, { message: '导入数据不能为空' })

export const importConfirmSchema = importBatchSchema

export const waitlistSchema = z.object({
  sessionId: z.number().int().positive(),
  customerName: z.string().min(1).max(50),
  customerPhone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }),
  playerCount: z.number().int().positive(),
  remark: z.string().optional(),
})

export const waitlistUpdateSchema = z.object({
  playerCount: z.number().int().positive().optional(),
  status: z.nativeEnum(WaitlistStatus).optional(),
  remark: z.string().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const waitlistQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  sessionId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(WaitlistStatus).optional(),
  keyword: z.string().optional(),
})

export const waitlistConfirmSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional().default(BookingStatus.PENDING),
  remark: z.string().optional(),
})

export const sessionIdParamSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
})

export const hostRecommendSchema = z.object({
  storeId: z.coerce.number().int().positive().optional().default(1),
  scriptId: z.number().int().positive(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  limit: z.coerce.number().int().positive().max(20).optional().default(5),
}).refine(data => data.endTime > data.startTime, {
  message: '结束时间必须晚于开始时间',
  path: ['endTime'],
})

export const membershipActivateSchema = z.object({
  customerId: z.number().int().positive(),
  initialBalance: z.coerce.number().min(0).optional().default(0),
  operator: z.string().optional(),
  remark: z.string().optional(),
})

export const membershipRechargeSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.coerce.number().positive(),
  operator: z.string().optional(),
  remark: z.string().optional(),
})

export const membershipConsumeSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.coerce.number().positive(),
  operator: z.string().optional(),
  remark: z.string().optional(),
})

export const membershipRefundSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.coerce.number().positive(),
  operator: z.string().optional(),
  remark: z.string().optional(),
  transactionId: z.number().int().positive().optional(),
})

export const membershipTransactionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  storeId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  type: z.nativeEnum(MembershipTransactionType).optional(),
  status: z.nativeEnum(MembershipTransactionStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

export const customerIdParamSchema = z.object({
  customerId: z.coerce.number().int().positive(),
})


