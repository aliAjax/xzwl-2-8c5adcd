import { Router, RequestHandler } from 'express'
import { previewImport, confirmImport } from './import.controller'

const router = Router()
const typedHandler = (handler: unknown): RequestHandler => handler as RequestHandler

router.post('/preview', typedHandler(previewImport))
router.post('/confirm', typedHandler(confirmImport))

export default router
