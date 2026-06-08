import { Response, NextFunction } from 'express'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  dailyCloseCreateSchema,
  dailyCloseQuerySchema,
  dailyCloseVoidSchema,
  dailyCloseSummaryQuerySchema,
  dailyCloseDiffQuerySchema,
  dailyCloseRecloseSchema,
  idParamSchema,
} from '../../common/schemas'
import {
  createDailyClose,
  getDailyCloseList,
  getDailyCloseDetail,
  voidAndRecreateDailyClose,
  getDailyCloseSummary,
  getDailyCloseDiff,
  recloseDailyClose,
} from './dailyClose.service'

type CreateDailyCloseRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof dailyCloseCreateSchema>
>

type GetDailyCloseListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof dailyCloseQuerySchema>,
  Record<string, never>
>

type GetDailyCloseDetailRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  Record<string, never>
>

type VoidDailyCloseRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof dailyCloseVoidSchema>
>

type GetDailyCloseSummaryRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof dailyCloseSummaryQuerySchema>,
  Record<string, never>
>

type GetDailyCloseDiffRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof dailyCloseDiffQuerySchema>,
  Record<string, never>
>

type RecloseDailyCloseRequest = TypedRequest<
  Record<string, never>,
  Record<string, never>,
  InferSchemaType<typeof dailyCloseRecloseSchema>
>

export const create = async (req: CreateDailyCloseRequest, res: Response, next: NextFunction) => {
  try {
    const result = await createDailyClose(req.body)
    res.sendSuccess(result, '日结单创建成功')
  } catch (error) {
    next(error)
  }
}

export const getList = async (req: GetDailyCloseListRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, storeId, status, startDate, endDate } = req.query
    const { list, total } = await getDailyCloseList({
      page,
      pageSize,
      storeId,
      status,
      startDate,
      endDate,
    })
    res.sendSuccess(createPaginationResult(list, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getDetail = async (req: GetDailyCloseDetailRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const result = await getDailyCloseDetail(id)
    res.sendSuccess(result)
  } catch (error) {
    next(error)
  }
}

export const voidAndRecreate = async (req: VoidDailyCloseRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { operator, remark } = req.body
    const result = await voidAndRecreateDailyClose(id, { operator, remark })
    res.sendSuccess(result, '日结单作废重开成功')
  } catch (error) {
    next(error)
  }
}

export const getSummary = async (req: GetDailyCloseSummaryRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, startDate, endDate } = req.query
    const result = await getDailyCloseSummary({ storeId, startDate, endDate })
    res.sendSuccess(result)
  } catch (error) {
    next(error)
  }
}

export const getDiff = async (req: GetDailyCloseDiffRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, businessDate } = req.query
    const result = await getDailyCloseDiff({ storeId, businessDate })
    res.sendSuccess(result)
  } catch (error) {
    next(error)
  }
}

export const reclose = async (req: RecloseDailyCloseRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId, businessDate, operator, remark } = req.body
    const result = await recloseDailyClose({ storeId, businessDate, operator, remark })
    res.sendSuccess(result, '日结差异重结成功')
  } catch (error) {
    next(error)
  }
}
