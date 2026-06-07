import { Router, RequestHandler } from 'express'
import {
  activateMembershipHandler,
  rechargeHandler,
  consumeHandler,
  refundHandler,
  getTransactionListHandler,
  getAccountByCustomerIdHandler,
} from './membership.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  membershipActivateSchema,
  membershipRechargeSchema,
  membershipConsumeSchema,
  membershipRefundSchema,
  membershipTransactionQuerySchema,
  customerIdParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/activate', validateBody(membershipActivateSchema), typedHandler(activateMembershipHandler))
router.post('/recharge', validateBody(membershipRechargeSchema), typedHandler(rechargeHandler))
router.post('/consume', validateBody(membershipConsumeSchema), typedHandler(consumeHandler))
router.post('/refund', validateBody(membershipRefundSchema), typedHandler(refundHandler))
router.get('/transactions', validateQuery(membershipTransactionQuerySchema), typedHandler(getTransactionListHandler))
router.get('/account/:customerId', validateParams(customerIdParamSchema), typedHandler(getAccountByCustomerIdHandler))

export default router
