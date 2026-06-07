import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import {
  createSession,
  getSessionList,
  getSessionById,
  updateSession,
  deleteSession,
  getHostSchedule,
  getAvailableSessions,
} from './session.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  sessionSchema,
  sessionUpdateSchema,
  sessionQuerySchema,
  availableSessionQuerySchema,
  idParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(sessionSchema), typedHandler(createSession))
router.get('/', validateQuery(sessionQuerySchema), typedHandler(getSessionList))
router.get('/available', validateQuery(availableSessionQuerySchema), typedHandler(getAvailableSessions))
router.get('/host/:hostId', validateParams(z.object({ hostId: z.coerce.number().int().positive() })), typedHandler(getHostSchedule))
router.get('/:id', validateParams(idParamSchema), typedHandler(getSessionById))
router.put('/:id', validateParams(idParamSchema), validateBody(sessionUpdateSchema), typedHandler(updateSession))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteSession))

export default router
