import { Request, Response, NextFunction } from 'express'

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data?: T
  timestamp: number
}

declare global {
  namespace Express {
    interface Response {
      sendSuccess: <T>(data?: T, message?: string) => Response
      sendError: (message: string, statusCode?: number) => Response
    }
  }
}

export const responseMiddleware = (req: Request, res: Response, next: NextFunction) => {
  res.sendSuccess = <T>(data?: T, message = 'Success') => {
    const response: ApiResponse<T> = {
      success: true,
      message,
      data,
      timestamp: Date.now(),
    }
    return res.json(response)
  }

  res.sendError = (message: string, statusCode = 400) => {
    const response: ApiResponse = {
      success: false,
      message,
      timestamp: Date.now(),
    }
    return res.status(statusCode).json(response)
  }

  next()
}
