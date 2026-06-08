import { Router, RequestHandler } from 'express'
import {
  getNotificationTaskListHandler,
  getNotificationTaskByIdHandler,
  retryNotificationTaskHandler,
  processPendingTasksHandler
} from './notification.controller'
import { validateQuery, validateParams } from '../../middleware/validate'
import {
  notificationQuerySchema,
  notificationIdParamSchema
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.get('/', validateQuery(notificationQuerySchema), typedHandler(getNotificationTaskListHandler))
router.get('/:id', validateParams(notificationIdParamSchema), typedHandler(getNotificationTaskByIdHandler))
router.post('/:id/retry', validateParams(notificationIdParamSchema), typedHandler(retryNotificationTaskHandler))
router.post('/process', typedHandler(processPendingTasksHandler))

export default router
