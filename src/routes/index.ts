import { Router } from 'express'
import scriptRoutes from '../modules/script/script.routes'
import hostRoutes from '../modules/host/host.routes'
import proficiencyRoutes from '../modules/proficiency/proficiency.routes'
import sessionRoutes from '../modules/session/session.routes'
import roomRoutes from '../modules/room/room.routes'
import bookingRoutes from '../modules/booking/booking.routes'
import waitlistRoutes from '../modules/waitlist/waitlist.routes'
import statsRoutes from '../modules/stats/stats.routes'
import customerRoutes from '../modules/customer/customer.routes'
import importRoutes from '../modules/import/import.routes'
import membershipRoutes from '../modules/membership/membership.routes'

const router = Router()

router.get('/health', (req, res) => {
  res.sendSuccess({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

router.use('/scripts', scriptRoutes)
router.use('/hosts', hostRoutes)
router.use('/proficiencies', proficiencyRoutes)
router.use('/sessions', sessionRoutes)
router.use('/rooms', roomRoutes)
router.use('/bookings', bookingRoutes)
router.use('/waitlists', waitlistRoutes)
router.use('/stats', statsRoutes)
router.use('/customers', customerRoutes)
router.use('/import', importRoutes)
router.use('/membership', membershipRoutes)

export default router
