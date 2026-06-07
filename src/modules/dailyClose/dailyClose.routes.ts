import { Router, RequestHandler } from 'express'
import {
  create,
  getList,
  getDetail,
  voidAndRecreate,
} from './dailyClose.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  dailyCloseCreateSchema,
  dailyCloseQuerySchema,
  dailyCloseVoidSchema,
  idParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(dailyCloseCreateSchema), typedHandler(create))
router.get('/', validateQuery(dailyCloseQuerySchema), typedHandler(getList))
router.get('/:id', validateParams(idParamSchema), typedHandler(getDetail))
router.post('/:id/void', validateParams(idParamSchema), validateBody(dailyCloseVoidSchema), typedHandler(voidAndRecreate))

export default router
