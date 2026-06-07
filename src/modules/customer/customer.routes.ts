import { Router, RequestHandler } from 'express'
import {
  getCustomerList,
  getCustomerById,
  updateCustomer,
} from './customer.controller'
import { validateQuery, validateParams, validateBody } from '../../middleware/validate'
import {
  customerQuerySchema,
  customerUpdateSchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.get('/', validateQuery(customerQuerySchema), typedHandler(getCustomerList))
router.get('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(getCustomerById))
router.put('/:id', validateParams(idParamSchema), validateBody(customerUpdateSchema), typedHandler(updateCustomer))

export default router
