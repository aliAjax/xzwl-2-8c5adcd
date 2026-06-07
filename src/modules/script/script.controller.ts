import { Response, NextFunction } from 'express'
import prisma from '../../prisma/client'
import { AppError } from '../../middleware/errorHandler'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  scriptSchema,
  scriptUpdateSchema,
  paginationSchema,
  idParamSchema,
} from '../../common/schemas'

type CreateScriptRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof scriptSchema>
>

type UpdateScriptRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof scriptUpdateSchema>
>

type GetScriptListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof paginationSchema>,
  Record<string, never>
>

type GetScriptByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const createScript = async (req: CreateScriptRequest, res: Response, next: NextFunction) => {
  try {
    const script = await prisma.script.create({
      data: req.body,
    })
    res.sendSuccess(script, '剧本创建成功')
  } catch (error) {
    next(error)
  }
}

export const getScriptList = async (req: GetScriptListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword } = req.query

    const where: Record<string, unknown> = {}
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ]
    }

    const [scripts, total] = await Promise.all([
      prisma.script.findMany({
        where,
        include: {
          proficiencies: {
            include: {
              host: {
                select: { id: true, name: true },
              },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.script.count({ where }),
    ])

    res.sendSuccess(createPaginationResult(scripts, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getScriptById = async (req: GetScriptByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const script = await prisma.script.findUnique({
      where: { id },
      include: {
        proficiencies: {
          include: {
            host: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
        sessions: {
          take: 10,
          orderBy: { startTime: 'desc' },
          include: {
            host: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!script) {
      throw new AppError('剧本不存在', 404)
    }

    res.sendSuccess(script)
  } catch (error) {
    next(error)
  }
}

export const updateScript = async (req: UpdateScriptRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const script = await prisma.script.update({
      where: { id },
      data: req.body,
    })

    res.sendSuccess(script, '剧本更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteScript = async (req: GetScriptByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    await prisma.script.delete({
      where: { id },
    })

    res.sendSuccess(null, '剧本删除成功')
  } catch (error) {
    next(error)
  }
}
