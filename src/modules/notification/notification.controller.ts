import { Response, NextFunction } from 'express'
import { TypedRequest, InferSchemaType } from '../../common/express'
import {
  notificationQuerySchema,
  notificationIdParamSchema,
  detailQuerySchema,
} from '../../common/schemas'
import {
  getNotificationTaskList,
  getNotificationTaskById,
  retryNotificationTask,
  processPendingNotifications,
} from './notification.service'
import { AppError } from '../../middleware/errorHandler'

type GetNotificationTaskListRequest = TypedRequest<
  Record<string, never>,
  InferSchemaType<typeof notificationQuerySchema>,
  Record<string, never>
>

type GetNotificationTaskByIdRequest = TypedRequest<
  InferSchemaType<typeof notificationIdParamSchema>,
  InferSchemaType<typeof detailQuerySchema>,
  Record<string, never>
>

type RetryNotificationTaskRequest = TypedRequest<
  InferSchemaType<typeof notificationIdParamSchema>,
  Record<string, never>,
  Record<string, never>
>

export const getNotificationTaskListHandler = async (
  req: GetNotificationTaskListRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { page, pageSize, type, status, channel, recipientPhone, relatedCustomerId, relatedSessionId, startDate, endDate, storeId } = req.query

    const result = await getNotificationTaskList(page, pageSize, {
      type,
      status,
      channel,
      recipientPhone,
      relatedCustomerId,
      relatedSessionId,
      startDate,
      endDate,
      storeId,
    })

    res.sendSuccess(result)
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

    if (!task) {
      throw new AppError('通知任务不存在', 404)
    }

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
    const result = await processPendingNotifications()

    res.sendSuccess(
      result,
      `后台处理完成，成功 ${result.success} 条，失败 ${result.failed} 条`
    )
  } catch (error) {
    next(error)
  }
}
