import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { responseMiddleware } from './middleware/response'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import routes from './routes'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.use(responseMiddleware)

app.use('/api/v1', routes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
