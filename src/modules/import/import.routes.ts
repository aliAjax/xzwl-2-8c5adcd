import { Router, RequestHandler } from 'express'
import { previewImport, confirmImport } from './import.controller'
import { validateBody } from '../../middleware/validate'
import { importBatchSchema, importConfirmSchema } from '../../common/schemas'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/preview', validateBody(importBatchSchema), typedHandler(previewImport))
router.post('/confirm', validateBody(importConfirmSchema), typedHandler(confirmImport))

export default router
