import { Request, Response } from 'express';
import { CreateAdminUseCase, GetAdminsUseCase, LoginAdminUseCase } from '../application/AdminUseCases';

export class AdminController {
  constructor(
    private createAdminUseCase: CreateAdminUseCase,
    private getAdminsUseCase: GetAdminsUseCase,
    private loginAdminUseCase: LoginAdminUseCase
  ) {}

  async getAll(req: Request, res: Response) {
    try {
      const admins = await this.getAdminsUseCase.execute();
      res.json(admins);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const admin = await this.createAdminUseCase.execute(req.body);
      // Remove password from response
      const { password: _, ...adminWithoutPassword } = admin;
      res.status(201).json(adminWithoutPassword);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;
    try {
      const result = await this.loginAdminUseCase.execute(email, password);
      
      // Detectar si la solicitud viene por HTTPS (túneles de desarrollo o producción)
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers.host?.includes('devtunnels.ms');

      // Establecer la cookie HTTP-Only segura con el token de administrador
      res.cookie('admin_token', result.token, {
        httpOnly: true,
        secure: isHttps ? true : false,
        sameSite: isHttps ? 'none' : 'lax', // Requerido 'none' para cross-site en Dev Tunnels de https a http://localhost
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        path: '/',
      });

      // Retornar la información del administrador y el token para el BFF del frontend
      res.json({ admin: result.admin, token: result.token });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }

  async logout(req: Request, res: Response) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers.host?.includes('devtunnels.ms');

    res.clearCookie('admin_token', {
      httpOnly: true,
      secure: isHttps ? true : false,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/',
    });
    res.json({ success: true });
  }
}
