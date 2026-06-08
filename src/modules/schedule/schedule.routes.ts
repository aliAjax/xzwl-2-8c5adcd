import { Router, RequestHandler } from 'express'
import { z } from 'zod'
import {
  generateSchedule,
  getSchedulePlanList,
  getSchedulePlanById,
  confirmPlan,
  deletePlan,
  updateDraftSession,
  deleteDraftSession,
  validateForPublish,
  publishPlan,
} from './schedule.controller'
import { validateBody, validateQuery, validateParams } from '../../middleware/validate'
import {
  generateScheduleSchema,
  schedulePlanQuerySchema,
  idParamSchema,
  confirmScheduleSchema,
  scheduleDraftUpdateSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

const draftIdParamSchema = z.object({
  planId: z.coerce.number().int().positive(),
  draftId: z.coerce.number().int().positive(),
})

router.post('/generate', validateBody(generateScheduleSchema), typedHandler(generateSchedule))
router.get('/', validateQuery(schedulePlanQuerySchema), typedHandler(getSchedulePlanList))
router.get('/:id', validateParams(idParamSchema), typedHandler(getSchedulePlanById))
router.post('/:id/confirm', validateParams(idParamSchema), validateBody(confirmScheduleSchema), typedHandler(confirmPlan))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deletePlan))
router.get('/:id/validate-publish', validateParams(idParamSchema), typedHandler(validateForPublish))
router.post('/:id/publish', validateParams(idParamSchema), validateBody(confirmScheduleSchema), typedHandler(publishPlan))

router.put(
  '/:planId/drafts/:draftId',
  validateParams(draftIdParamSchema),
  validateBody(scheduleDraftUpdateSchema),
  typedHandler(updateDraftSession)
)
router.delete(
  '/:planId/drafts/:draftId',
  validateParams(draftIdParamSchema),
  typedHandler(deleteDraftSession)
)

export default router
