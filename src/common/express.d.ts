import { Request } from 'express'
import { ZodSchema, z } from 'zod'

export interface TypedRequest<
  TParams = Record<string, never>,
  TQuery = Record<string, never>,
  TBody = Record<string, never>
> extends Request {
  params: TParams
  query: TQuery
  body: TBody
}

export type InferSchemaType<T extends ZodSchema> = z.infer<T>

export type ValidatedRequest<
  TParamsSchema extends ZodSchema = ZodSchema,
  TQuerySchema extends ZodSchema = ZodSchema,
  TBodySchema extends ZodSchema = ZodSchema
> = TypedRequest<
  InferSchemaType<TParamsSchema>,
  InferSchemaType<TQuerySchema>,
  InferSchemaType<TBodySchema>
>
