import { Router, RequestHandler } from 'express'
import {
  createProficiency,
  getProficiencyList,
  getProficiencyById,
  updateProficiency,
  deleteProficiency,
} from './proficiency.controller'
import { validateBody, validateParams } from '../../middleware/validate'
import {
  proficiencySchema,
  proficiencyUpdateSchema,
  idParamSchema,
} from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/', validateBody(proficiencySchema), typedHandler(createProficiency))
router.get('/', typedHandler(getProficiencyList))
router.get('/:id', validateParams(idParamSchema), typedHandler(getProficiencyById))
router.put('/:id', validateParams(idParamSchema), validateBody(proficiencyUpdateSchema), typedHandler(updateProficiency))
router.delete('/:id', validateParams(idParamSchema), typedHandler(deleteProficiency))

export default router
