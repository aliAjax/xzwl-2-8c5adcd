import { Router, RequestHandler } from 'express'
import {
  createStore,
  getStoreList,
  getStoreById,
  updateStore,
  deleteStore,
  assignHostToStores,
} from './store.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  storeSchema,
  storeUpdateSchema,
  paginationSchema,
  idParamSchema,
  hostAssignStoreSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(storeSchema), typedHandler(createStore))
router.post('/assign-host', validateBody(hostAssignStoreSchema), typedHandler(assignHostToStores))
router.get('/', validateQuery(paginationSchema), typedHandler(getStoreList))
router.get('/:id', validateParams(idParamSchema), typedHandler(getStoreById))
router.put('/:id', validateParams(idParamSchema), validateBody(storeUpdateSchema), typedHandler(updateStore))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteStore))

export default router
