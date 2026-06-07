import { z } from 'zod'
import { Difficulty, ProficiencyLevel, SessionStatus, BookingStatus } from '@prisma/client'

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  keyword: z.string().optional(),
})

export const scriptSchema = z.object({
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
  name: z.string().min(1).max(50),
  phone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }),
  avatar: z.string().url().optional(),
  isActive: z.boolean().optional().default(true),
})

export const hostUpdateSchema = hostSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)

export const proficiencySchema = z.object({
  hostId: z.number().int().positive(),
  scriptId: z.number().int().positive(),
  level: z.nativeEnum(ProficiencyLevel),
})

export const proficiencyUpdateSchema = z.object({
  level: z.nativeEnum(ProficiencyLevel),
})

export const sessionSchema = z.object({
  scriptId: z.number().int().positive(),
  hostId: z.number().int().positive(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  status: z.nativeEnum(SessionStatus).optional().default(SessionStatus.PENDING),
  room: z.string().optional(),
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
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  status: z.nativeEnum(SessionStatus).optional(),
  room: z.string().optional(),
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
  scriptId: z.coerce.number().int().positive().optional(),
  hostId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(SessionStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

export const bookingSchema = z.object({
  sessionId: z.number().int().positive(),
  customerName: z.string().min(1).max(50),
  customerPhone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }),
  playerCount: z.number().int().positive(),
  status: z.nativeEnum(BookingStatus).optional().default(BookingStatus.PENDING),
  remark: z.string().optional(),
})

export const bookingUpdateSchema = z.object({
  status: z.nativeEnum(BookingStatus).optional(),
  playerCount: z.number().int().positive().optional(),
  remark: z.string().optional(),
})

export const bookingQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  sessionId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(BookingStatus).optional(),
  keyword: z.string().optional(),
})

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional().default(30),
  scriptId: z.coerce.number().int().positive().optional(),
})

export const customerQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  keyword: z.string().optional(),
})

export const customerUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }).optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: '至少需要提供一个更新字段' }
)
