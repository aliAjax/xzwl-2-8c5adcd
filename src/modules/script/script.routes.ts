import { Router, RequestHandler } from 'express'
import {
  createScript,
  getScriptList,
  getScriptById,
  updateScript,
  deleteScript,
} from './script.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  scriptSchema,
  scriptUpdateSchema,
  paginationSchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(scriptSchema), typedHandler(createScript))
router.get('/', validateQuery(paginationSchema), typedHandler(getScriptList))
router.get('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(getScriptById))
router.put('/:id', validateParams(idParamSchema), validateBody(scriptUpdateSchema), typedHandler(updateScript))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteScript))

export default router
