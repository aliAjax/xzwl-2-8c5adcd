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
  detailQuerySchema,
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
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

const DEFAULT_STORE_ID = 1

export const createScript = async (req: CreateScriptRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, ...data } = req.body
    const effectiveStoreId = storeId ?? DEFAULT_STORE_ID

    const store = await prisma.store.findUnique({
      where: { id: effectiveStoreId },
    })
    if (!store) {
      throw new AppError('门店不存在', 404)
    }

    const existingScript = await prisma.script.findUnique({
      where: {
        storeId_name: {
          storeId: effectiveStoreId,
          name: data.name,
        },
      },
    })
    if (existingScript) {
      throw new AppError('该门店下剧本名称已存在', 409)
    }

    const script = await prisma.script.create({
      data: {
        ...data,
        storeId: effectiveStoreId,
      },
    })
    res.sendSuccess(script, '剧本创建成功')
  } catch (error) {
    next(error)
  }
}

export const getScriptList = async (req: GetScriptListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, keyword, storeId } = req.query

    const where: Record<string, unknown> = {}
    if (storeId !== undefined) {
      where.storeId = storeId
    }
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
          store: { select: { id: true, name: true } },
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
    const { storeId } = req.query

    const script = await prisma.script.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true } },
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

    if (storeId !== undefined && script.storeId !== storeId) {
      throw new AppError('剧本不属于该门店', 404)
    }

    res.sendSuccess(script)
  } catch (error) {
    next(error)
  }
}

export const updateScript = async (req: UpdateScriptRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { storeId, name, ...data } = req.body

    const existingScript = await prisma.script.findUnique({
      where: { id },
    })
    if (!existingScript) {
      throw new AppError('剧本不存在', 404)
    }

    const effectiveStoreId = storeId ?? existingScript.storeId

    if (storeId !== undefined && storeId !== existingScript.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
      })
      if (!store) {
        throw new AppError('门店不存在', 404)
      }
    }

    if (name !== undefined) {
      const duplicateScript = await prisma.script.findUnique({
        where: {
          storeId_name: {
            storeId: effectiveStoreId,
            name,
          },
        },
      })
      if (duplicateScript && duplicateScript.id !== id) {
        throw new AppError('该门店下剧本名称已存在', 409)
      }
    }

    const script = await prisma.script.update({
      where: { id },
      data: {
        ...data,
        ...(name !== undefined && { name }),
        ...(storeId !== undefined && { storeId }),
      },
    })

    res.sendSuccess(script, '剧本更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteScript = async (req: GetScriptByIdRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const existingScript = await prisma.script.findUnique({
      where: { id },
    })
    if (!existingScript) {
      throw new AppError('剧本不存在', 404)
    }

    await prisma.script.delete({
      where: { id },
    })

    res.sendSuccess(null, '剧本删除成功')
  } catch (error) {
    next(error)
  }
}
