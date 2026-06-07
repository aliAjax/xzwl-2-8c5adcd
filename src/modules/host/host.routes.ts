import { Router, RequestHandler } from 'express'
import {
  createHost,
  getHostList,
  getHostById,
  updateHost,
  deleteHost,
} from './host.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  hostSchema,
  hostUpdateSchema,
  paginationSchema,
  idParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(hostSchema), typedHandler(createHost))
router.get('/', validateQuery(paginationSchema), typedHandler(getHostList))
router.get('/:id', validateParams(idParamSchema), typedHandler(getHostById))
router.put('/:id', validateParams(idParamSchema), validateBody(hostUpdateSchema), typedHandler(updateHost))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteHost))

export default router
