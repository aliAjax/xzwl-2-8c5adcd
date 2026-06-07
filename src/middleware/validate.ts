import { Request, Response, NextFunction, RequestHandler } from 'express'
import { ZodSchema, z } from 'zod'
import { TypedRequest, InferSchemaType } from '../common/express'

export const validate = <
  TParams extends ZodSchema = ZodSchema,
  TQuery extends ZodSchema = ZodSchema,
  TBody extends ZodSchema = ZodSchema
>(schema: ZodSchema): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      })
      next()
    } catch (error) {
      next(error)
    }
  }
}

export const validateBody = <T extends ZodSchema>(
  schema: T
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body) as InferSchemaType<T>
      next()
    } catch (error) {
      next(error)
    }
  }
}

export const validateQuery = <T extends ZodSchema>(
  schema: T
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as InferSchemaType<T>
      next()
    } catch (error) {
      next(error)
    }
  }
}

export const validateParams = <T extends ZodSchema>(
  schema: T
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as InferSchemaType<T>
      next()
    } catch (error) {
      next(error)
    }
  }
}

export type TypedHandler<
  TParams = Record<string, never>,
  TQuery = Record<string, never>,
  TBody = Record<string, never>
> = (
  req: TypedRequest<TParams, TQuery, TBody>,
  res: Response,
  next: NextFunction
) => Promise<void> | void
