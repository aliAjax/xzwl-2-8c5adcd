import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  proficiencySchema,
  proficiencyUpdateSchema,
  idParamSchema,
} from '../../common/schemas'

type CreateProficiencyRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof proficiencySchema>
>

type UpdateProficiencyRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof proficiencyUpdateSchema>
>

type GetProficiencyListRequest = TypedRequest<
  Record<string, never>,
  { hostId?: number; scriptId?: number; storeId?: number; page?: number; pageSize?: number },
  Record<string, never>
>

type GetProficiencyByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const createProficiency = async (req: CreateProficiencyRequest, res: Response, next: NextFunction) => {
  try {
    const { hostId, scriptId } = req.body

    const [host, script] = await Promise.all([
      prisma.host.findUnique({ where: { id: hostId } }),
      prisma.script.findUnique({ where: { id: scriptId }, include: { store: { select: { id: true, name: true } } } }),
    ])

    if (!host) {
      throw new AppError('主持人不存在', 404)
    }
    if (!script) {
      throw new AppError('剧本不存在', 404)
    }

    const proficiency = await prisma.hostProficiency.create({
      data: req.body,
      include: {
        host: { select: { id: true, name: true } },
        script: { select: { id: true, name: true, difficulty: true, store: { select: { id: true, name: true } } } },
      },
    })

    res.sendSuccess(proficiency, '熟练度设置成功')
  } catch (error) {
    next(error)
  }
}

export const getProficiencyList = async (req: GetProficiencyListRequest, res: Response, next: NextFunction) => {
  try {
    const { hostId, scriptId, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (hostId) {
      where.hostId = Number(hostId)
    }
    if (scriptId) {
      where.scriptId = Number(scriptId)
    }
    if (storeId) {
      where.script = { storeId: Number(storeId) }
    }

    const proficiencies = await prisma.hostProficiency.findMany({
      where,
      include: {
        host: { select: { id: true, name: true, phone: true } },
        script: { select: { id: true, name: true, difficulty: true, store: { select: { id: true, name: true } } } },
      },
      orderBy: { level: 'desc' },
    })

    res.sendSuccess(proficiencies)
  } catch (error) {
    next(error)
  }
}

export const getProficiencyById = async (req: GetProficiencyByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const proficiency = await prisma.hostProficiency.findUnique({
      where: { id },
      include: {
        host: { select: { id: true, name: true, phone: true } },
        script: { select: { id: true, name: true, difficulty: true, store: { select: { id: true, name: true } } } },
      },
    })

    if (!proficiency) {
      throw new AppError('熟练度记录不存在', 404)
    }

    res.sendSuccess(proficiency)
  } catch (error) {
    next(error)
  }
}

export const updateProficiency = async (req: UpdateProficiencyRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const proficiency = await prisma.hostProficiency.update({
      where: { id },
      data: req.body,
      include: {
        host: { select: { id: true, name: true } },
        script: { select: { id: true, name: true, store: { select: { id: true, name: true } } } },
      },
    })

    res.sendSuccess(proficiency, '熟练度更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteProficiency = async (req: GetProficiencyByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    await prisma.hostProficiency.delete({
      where: { id },
    })

    res.sendSuccess(null, '熟练度删除成功')
  } catch (error) {
    next(error)
  }
}
