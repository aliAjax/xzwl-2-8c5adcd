import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export class AppError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
    this.name = 'AppError'
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('[Error]', err)

  if (err instanceof AppError) {
    return res.sendError(err.message, err.statusCode)
  }

  if (err instanceof ZodError) {
    const errors = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
    return res.sendError(`参数验证失败: ${errors}`, 400)
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta as { target?: string[] })?.target?.join(', ') || '字段'
      return res.sendError(`${target} 已存在`, 409)
    }
    if (err.code === 'P2025') {
      return res.sendError('记录不存在', 404)
    }
    if (err.code === 'P2003') {
      return res.sendError('关联数据不存在', 400)
    }
  }

  if (err.name === 'UnauthorizedError') {
    return res.sendError('未授权访问', 401)
  }

  return res.sendError('服务器内部错误', 500)
}

export const notFoundHandler = (req: Request, res: Response) => {
  res.sendError(`接口不存在: ${req.method} ${req.path}`, 404)
}
