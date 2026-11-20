import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/auth.decorators';
import { updateMeSchema, type UpdateMeDto } from './dto/update-me.dto';
import type { UserDto } from './user.mapper';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** La primera llamada después del login: también registra el último acceso. */
  @Get()
  getMe(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.usersService.getMe(user, { isLogin: true });
  }

  @Patch()
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body({ schema: updateMeSchema }) changes: UpdateMeDto,
  ): Promise<UserDto> {
    return this.usersService.updateMe(user, changes);
  }
}
