import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../shared/entities/user.entity';
import { Wallet } from '../../shared/entities/wallet.entity';
import { Business } from '../../shared/entities/business.entity';
import { RegisterDto, LoginDto, AuthResponseDto, AdminRegisterDto } from '../../shared/dtos/auth.dto';
import { UserRole, BusinessScope, BusinessStatus } from '../../shared/enums';
import { StringValue } from 'ms';
import { EmailService } from '../../shared/services/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,

    private jwtService: JwtService,
    private dataSource: DataSource,
    private emailService: EmailService,
  ) {}

  // ================= REGISTER =================
  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    return this.dataSource.transaction(async manager => {
      const existingUser = await manager.findOne(User, {
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new BadRequestException('Email already registered');
      }

      const hashedPassword = await bcrypt.hash(registerDto.password, 12);

      const user = manager.create(User, {
        email: registerDto.email,
        passwordHash: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phone: registerDto.phone,
      });

      const savedUser = await manager.save(user);

      const wallet = manager.create(Wallet, {
        userId: savedUser.id,
        balance: 0,
      });

      await manager.save(wallet);

      return this.generateAuthResponse(savedUser);
    });
  }

  // ================= ADMIN REGISTER =================
  async adminRegister(dto: AdminRegisterDto): Promise<AuthResponseDto> {
    // Only allow ADMIN or MANAGER role
    if (dto.role !== UserRole.ADMIN && dto.role !== UserRole.MANAGER) {
      throw new BadRequestException('Only ADMIN or MANAGER role is allowed for admin registration');
    }

    return this.dataSource.transaction(async manager => {
      const existingUser = await manager.findOne(User, {
        where: { email: dto.email },
      });

      if (existingUser) {
        throw new BadRequestException('Email already registered');
      }

      const hashedPassword = await bcrypt.hash(dto.password, 12);

      const user = manager.create(User, {
        email: dto.email,
        passwordHash: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        businessScopes: dto.businessScopes ?? null,
      });

      const savedUser = await manager.save(user);

      const wallet = manager.create(Wallet, {
        userId: savedUser.id,
        balance: 0,
      });

      await manager.save(wallet);

      if (savedUser.role === UserRole.ADMIN) {
        const business = manager.create(Business, {
          ownerId: savedUser.id,
          name: `${dto.firstName} ${dto.lastName}'s Business`,
          businessScopes: dto.businessScopes?.length ? (dto.businessScopes as BusinessScope[]) : [BusinessScope.TABLE_CLUB],
          status: BusinessStatus.APPROVED,
          isActive: true,
        });
        await manager.save(business);
      }

      return this.generateAuthResponse(savedUser);
    });
  }

  // ================= LOGIN =================
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email },
    });

    // prevent timing attacks
    const fakeHash =
      '$2a$12$KbQiP7o9z4G5b6u8e8w3UOeV0tYz9Wj8eQJmZx9y7Q6cWf8y2xB6K';

    const passwordHash = user?.passwordHash || fakeHash;

    const passwordMatch = await bcrypt.compare(loginDto.password, passwordHash);

    if (!user || !passwordMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return this.generateAuthResponse(user);
  }

  // ================= REFRESH =================
  async refreshToken(token: string): Promise<AuthResponseDto> {
    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const user = await this.userRepository.findOne({
        where: { id: decoded.sub },
      });

      if (!user) throw new UnauthorizedException();

      return this.generateAuthResponse(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // ================= TOKEN CREATION =================
  private generateAuthResponse(user: User): AuthResponseDto {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: (process.env.JWT_EXPIRATION || '3600s') as StringValue,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_EXPIRATION || '604800s') as StringValue,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        businessScopes: user.businessScopes,
        isActive: user.isActive,
      },
    };
  }

  // used by JwtStrategy
  async validateUser(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  // ================= GET PROFILE =================
  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: [
        'id', 'email', 'firstName', 'lastName', 'phone',
        'role', 'isActive', 'businessScopes', 'lastLoginAt',
        'createdAt', 'updatedAt',
      ],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ================= FORGOT PASSWORD =================
  async forgotPassword(email: string): Promise<{ message: string; resetToken?: string }> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      // Don't reveal if the email exists — always return success
      return { message: 'If the email exists, a reset link has been sent.' };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'password-reset' },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: '900s', // 15 minutes
      },
    );

    const sent = await this.emailService.sendPasswordResetEmail({
      to: user.email,
      customerName: user.firstName,
      resetToken,
      expiresInMinutes: 15,
    });
    if (!sent) {
      // Don't throw — same reasoning as the "don't reveal if email exists"
      // branch above. Misconfigured SMTP shouldn't surface as an auth-flow
      // error to the end user; it's visible in EmailService's own logs.
      this.logger.warn(`Password reset email failed to send to ${user.email}`);
    }

    // The token only goes in the API response outside production, so a
    // developer can test the reset flow without real email configured.
    // In production, the email is the only way to get it.
    const includeTokenInResponse = process.env.NODE_ENV !== 'production';
    return {
      message: 'If the email exists, a reset link has been sent.',
      ...(includeTokenInResponse ? { resetToken } : {}),
    };
  }

  // ================= RESET PASSWORD =================
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      if (decoded.purpose !== 'password-reset') {
        throw new BadRequestException('Invalid reset token');
      }

      const user = await this.userRepository.findOne({
        where: { id: decoded.sub, email: decoded.email },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      await this.userRepository.save(user);

      return { message: 'Password reset successfully' };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      throw new BadRequestException('Invalid or expired reset token');
    }
  }
}