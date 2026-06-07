import { Router, RequestHandler } from 'express'
import {
  createBooking,
  getBookingList,
  getBookingById,
  updateBooking,
  deleteBooking,
} from './booking.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  bookingSchema,
  bookingUpdateSchema,
  bookingQuerySchema,
  idParamSchema,
  detailQuerySchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(bookingSchema), typedHandler(createBooking))
router.get('/', validateQuery(bookingQuerySchema), typedHandler(getBookingList))
router.get('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(getBookingById))
router.put('/:id', validateParams(idParamSchema), validateBody(bookingUpdateSchema), typedHandler(updateBooking))
router.delete('/:id', validateParams(idParamSchema), validateQuery(detailQuerySchema), typedHandler(deleteBooking))

export default router
