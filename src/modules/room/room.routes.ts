import { Router, RequestHandler } from 'express'
import {
  createRoom,
  getRoomList,
  getRoomById,
  updateRoom,
  deleteRoom,
  getRoomSchedule,
} from './room.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  roomSchema,
  roomUpdateSchema,
  roomQuerySchema,
  idParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(roomSchema), typedHandler(createRoom))
router.get('/', validateQuery(roomQuerySchema), typedHandler(getRoomList))
router.get('/:id/schedule', validateParams(idParamSchema), typedHandler(getRoomSchedule))
router.get('/:id', validateParams(idParamSchema), typedHandler(getRoomById))
router.put('/:id', validateParams(idParamSchema), validateBody(roomUpdateSchema), typedHandler(updateRoom))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteRoom))

export default router
