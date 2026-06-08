import { Response, NextFunction } from 'express'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  waitlistSchema,
  waitlistUpdateSchema,
  waitlistQuerySchema,
  waitlistConfirmSchema,
  idParamSchema,
  sessionIdParamSchema,
  detailQuerySchema,
} from '../../common/schemas'
import {
  createWaitlist,
  confirmWaitlistToBooking,
  processPendingWaitlists,
  updateWaitlist,
  getWaitlistById,
  getWaitlistList,
  deleteWaitlist,
} from './waitlist.service'

type CreateWaitlistRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof waitlistSchema>
>

type UpdateWaitlistRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof waitlistUpdateSchema>
>

type GetWaitlistListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof waitlistQuerySchema>,
  Record<string, never>
>

type GetWaitlistByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

type ConfirmWaitlistRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof waitlistConfirmSchema>
>

type ProcessWaitlistRequest = TypedRequest<
  InferSchemaType<typeof sessionIdParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const createWaitlistHandler = async (
  req: CreateWaitlistRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const waitlist = await createWaitlist(req.body)
    res.sendSuccess(waitlist, '候补成功')
  } catch (error) {
    next(error)
  }
}

export const getWaitlistListHandler = async (
  req: GetWaitlistListRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page, pageSize, sessionId, customerId, status, keyword, storeId, phone } = req.query
    const { waitlists, total } = await getWaitlistList(page, pageSize, {
      sessionId,
      customerId,
      status,
      keyword,
      storeId,
      phone,
    })
    res.sendSuccess(createPaginationResult(waitlists, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getWaitlistByIdHandler = async (
  req: GetWaitlistByIdRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { storeId } = req.query
    const waitlist = await getWaitlistById(id, storeId)
    res.sendSuccess(waitlist)
  } catch (error) {
    next(error)
  }
}

export const updateWaitlistHandler = async (
  req: UpdateWaitlistRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { storeId } = req.query as { storeId?: number }
    const { playerCount, status, remark } = req.body
    const waitlist = await updateWaitlist(id, { playerCount, status, remark }, storeId)
    res.sendSuccess(waitlist, '候补更新成功')
  } catch (error) {
    next(error)
  }
}

export const deleteWaitlistHandler = async (
  req: GetWaitlistByIdRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { storeId } = req.query
    await deleteWaitlist(id, storeId)
    res.sendSuccess(null, '候补取消成功')
  } catch (error) {
    next(error)
  }
}

export const confirmWaitlistHandler = async (
  req: ConfirmWaitlistRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { storeId } = req.query as { storeId?: number }
    const { status, remark } = req.body
    const result = await confirmWaitlistToBooking(id, status, remark, storeId)
    if (result.success) {
      res.sendSuccess(result, '候补转正成功')
    } else {
      res.sendSuccess(result, result.message)
    }
  } catch (error) {
    next(error)
  }
}

export const processWaitlistHandler = async (
  req: ProcessWaitlistRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { sessionId } = req.params
    const results = await processPendingWaitlists(sessionId)
    const successCount = results.filter(r => r.success).length
    const skippedCount = results.filter(r => !r.success).length
    res.sendSuccess(
      { 
        totalProcessed: results.length, 
        successCount,
        skippedCount,
        convertedWaitlists: results 
      },
      `处理完成，成功转正 ${successCount} 个候补，跳过 ${skippedCount} 个`
    )
  } catch (error) {
    next(error)
  }
}
