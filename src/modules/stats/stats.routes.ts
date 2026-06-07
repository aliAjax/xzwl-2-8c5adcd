import { Router, RequestHandler } from 'express'
import {
  getScriptStats,
  getHostStats,
  getOverviewStats,
} from './stats.controller'
import { validateQuery } from '../../middleware/validate'
import { statsQuerySchema } from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.get('/scripts', validateQuery(statsQuerySchema), typedHandler(getScriptStats))
router.get('/hosts', validateQuery(statsQuerySchema), typedHandler(getHostStats))
router.get('/overview', validateQuery(statsQuerySchema), typedHandler(getOverviewStats))

export default router
