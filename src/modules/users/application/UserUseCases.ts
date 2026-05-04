import { IUserRepository, User } from '../domain/User';
import { AuthService } from '../../../shared/infrastructure/AuthService';

export class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(userData: Partial<User>): Promise<User> {
    const existing = await this.userRepository.findByEmail(userData.email!);
    if (existing) {
      throw new Error('User already exists');
    }

    if (userData.password) {
      userData.password = await AuthService.hashPassword(userData.password);
    }

    return this.userRepository.save(userData);
  }
}

export class LoginUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(email: string, password: string): Promise<{ user: User, token: string }> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isValid = await AuthService.comparePassword(password, user.password!);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = AuthService.generateToken({ id: user.id, email: user.email, role: 'USER' });
    
    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    return { user: userWithoutPassword as User, token };
  }
}

export class GetUsersUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(): Promise<User[]> {
    return this.userRepository.findAll();
  }
}
