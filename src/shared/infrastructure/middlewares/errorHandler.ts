import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(`[Error] ${err.stack || err.message}`);

  const isProduction = process.env.NODE_ENV === 'production';

  // Specific handling for known error types can be added here
  if (err.name === 'PrismaClientKnownRequestError') {
    return res.status(400).json({
      error: 'Database operation failed',
      message: isProduction ? 'A database error occurred' : err.message
    });
  }

  res.status(err.status || 500).json({
    error: err.name || 'InternalServerError',
    message: isProduction ? 'An unexpected error occurred' : err.message
  });
};
