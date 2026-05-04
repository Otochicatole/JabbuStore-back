import { Request, Response } from 'express';
import { CreateUserUseCase, GetUsersUseCase, LoginUserUseCase } from '../application/UserUseCases';

export class UserController {
  constructor(
    private createUserUseCase: CreateUserUseCase,
    private getUsersUseCase: GetUsersUseCase,
    private loginUserUseCase: LoginUserUseCase
  ) {}

  async getAll(req: Request, res: Response) {
    try {
      const users = await this.getUsersUseCase.execute();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const user = await this.createUserUseCase.execute(req.body);
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;
    try {
      const result = await this.loginUserUseCase.execute(email, password);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
}
