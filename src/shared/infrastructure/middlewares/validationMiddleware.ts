import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validate = (schema: z.ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // .parseAsync no solo valida, sino que retorna el objeto con SOLO los campos definidos
      const validatedData = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Sobrescribimos req con los datos limpios (sanitizados)
      req.body = (validatedData as any).body;
      req.query = (validatedData as any).query;
      req.params = (validatedData as any).params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.issues.map(err => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      }
      next(error); // Pasamos al manejador global de errores
    }
  };
};
