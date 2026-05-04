import { z } from 'zod';
export declare const createUserSchema: z.ZodObject<{
    body: z.ZodObject<{
        email: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        password: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const loginUserSchema: z.ZodObject<{
    body: z.ZodObject<{
        email: z.ZodString;
        password: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
//# sourceMappingURL=userSchemas.d.ts.map