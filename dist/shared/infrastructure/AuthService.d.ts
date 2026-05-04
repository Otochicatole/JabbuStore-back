export declare class AuthService {
    static hashPassword(password: string): Promise<string>;
    static comparePassword(password: string, hash: string): Promise<boolean>;
    static generateToken(payload: any): string;
    static verifyToken(token: string): any;
}
//# sourceMappingURL=AuthService.d.ts.map