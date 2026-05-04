import { IAdminRepository, Admin } from '../domain/Admin';
import { AuthService } from '../../../shared/infrastructure/AuthService';

export class CreateAdminUseCase {
  constructor(private adminRepository: IAdminRepository) {}

  async execute(adminData: Partial<Admin>): Promise<Admin> {
    const existing = await this.adminRepository.findByEmail(adminData.email!);
    if (existing) {
      throw new Error('Admin already exists');
    }

    if (adminData.password) {
      adminData.password = await AuthService.hashPassword(adminData.password);
    }

    return this.adminRepository.save(adminData);
  }
}

export class LoginAdminUseCase {
  constructor(private adminRepository: IAdminRepository) {}

  async execute(email: string, password: string): Promise<{ admin: Admin, token: string }> {
    const admin = await this.adminRepository.findByEmail(email);
    if (!admin) {
      throw new Error('Invalid credentials');
    }

    const isValid = await AuthService.comparePassword(password, admin.password!);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = AuthService.generateToken({ id: admin.id, email: admin.email, role: 'ADMIN' });
    
    // Remove password from response
    const { password: _, ...adminWithoutPassword } = admin;
    
    return { admin: adminWithoutPassword as Admin, token };
  }
}

export class GetAdminsUseCase {
  constructor(private adminRepository: IAdminRepository) {}

  async execute(): Promise<Admin[]> {
    return this.adminRepository.findAll();
  }
}
