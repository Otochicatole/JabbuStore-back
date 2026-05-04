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
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
}
