import { Response, NextFunction } from 'express'
import { createPaginationResult } from '../../common/types'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  notificationTaskQuerySchema,
  notificationTaskRetrySchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'
import * as notificationService from './notification.service'

type GetNotificationTaskListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof notificationTaskQuerySchema>,
  Record<string, never>
>

type GetNotificationTaskByIdRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

type RetryNotificationTaskRequest = TypedRequest<
  InferSchemaType<typeof idParamSchema>,
  Record<string, never>,
  InferSchemaType<typeof notificationTaskRetrySchema>
>

export const getNotificationTaskListHandler = async (
  req: GetNotificationTaskListRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page, pageSize, type, status, channel, businessType, keyword, storeId } = req.query

    const { tasks, total } = await getNotificationTaskList(page, pageSize, {
      type,
      status,
      channel,
      businessType,
      keyword,
      storeId,
    })

    res.sendSuccess(createPaginationResult(tasks, total, page, pageSize))
  } catch (error) {
    next(error)
  }
}

export const getNotificationTaskByIdHandler = async (
  req: GetNotificationTaskByIdRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { storeId } = req.query

    const task = await getNotificationTaskById(id, storeId)

    res.sendSuccess(task)
  } catch (error) {
    next(error)
  }
}

export const retryNotificationTaskHandler = async (
  req: RetryNotificationTaskRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params

    const task = await retryNotificationTask(id)

    res.sendSuccess(task, '通知任务重试成功')
  } catch (error) {
    next(error)
  }
}

export const processPendingTasksHandler = async (
  req: TypedRequest<Record<string, never>, Record<string, never>, Record<string, never>>,
  res: Response,
  next: NextFunction
) => {
  try {
    const results = await processPendingTasks()

    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length

    res.sendSuccess(
      {
        total: results.length,
        success: successCount,
        failed: failCount,
        results,
      },
      `后台处理完成，成功 ${successCount} 条，失败 ${failCount} 条`
    )
  } catch (error) {
    next(error)
  }
}
