import { Router, RequestHandler } from 'express'
import {
  createWaitlistHandler,
  getWaitlistListHandler,
  getWaitlistByIdHandler,
  updateWaitlistHandler,
  deleteWaitlistHandler,
  confirmWaitlistHandler,
  processWaitlistHandler,
} from './waitlist.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  waitlistSchema,
  waitlistUpdateSchema,
  waitlistQuerySchema,
  waitlistConfirmSchema,
  idParamSchema,
  sessionIdParamSchema,
  detailQuerySchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(waitlistSchema), typedHandler(createWaitlistHandler))
router.get('/', validateQuery(waitlistQuerySchema), typedHandler(getWaitlistListHandler))
router.get('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(getWaitlistByIdHandler))
router.put('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), validateBody(waitlistUpdateSchema), typedHandler(updateWaitlistHandler))
router.delete('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(deleteWaitlistHandler))
router.post('/:id/confirm', validateParams(idParamSchema), validateQuery(detailQuerySchema), validateBody(waitlistConfirmSchema), typedHandler(confirmWaitlistHandler))
router.post('/session/:sessionId/process', validateParams(sessionIdParamSchema), typedHandler(processWaitlistHandler))

export default router
