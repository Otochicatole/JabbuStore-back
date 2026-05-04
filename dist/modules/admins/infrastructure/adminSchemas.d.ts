import { z } from 'zod';
export declare const createAdminSchema: z.ZodObject<{
    body: z.ZodObject<{
        username: z.ZodString;
        email: z.ZodString;
        password: z.ZodString;
        role: z.ZodOptional<z.ZodEnum<{
            ADMIN: "ADMIN";
            SUPER_ADMIN: "SUPER_ADMIN";
        }>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const loginAdminSchema: z.ZodObject<{
    body: z.ZodObject<{
        email: z.ZodString;
        password: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
//# sourceMappingURL=adminSchemas.d.ts.map