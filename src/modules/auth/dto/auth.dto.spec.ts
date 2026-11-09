import { ValidationPipe } from '@nestjs/common';
import { LoginDto, RegisterDto, UpdateProfileDto } from './auth.dto.js';

const pipe = new ValidationPipe({
  transform: true, whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422,
});
const registration = { email: ' User@Example.COM ', password: 'a sufficiently long password', firstName: ' First ', lastName: ' Last ' };

describe('authentication input boundaries', () => {
  it('normalizes identity fields and preserves password characters', async () => {
    const result = await pipe.transform(registration, { type: 'body', metatype: RegisterDto });
    expect(result).toMatchObject({ email: 'user@example.com', firstName: 'First', lastName: 'Last', password: registration.password });
  });

  it.each([
    { password: 'too short' }, { email: 'malformed' }, { email: 'üser@example.com' },
    { firstName: null }, { lastName: ' ' }, { roles: ['SUPER_ADMIN'] }, { status: 'ACTIVE' },
  ])('rejects invalid registration or privilege injection %j', async (changes) => {
    await expect(pipe.transform({ ...registration, ...changes }, { type: 'body', metatype: RegisterDto })).rejects.toMatchObject({ status: 422 });
  });

  it('accepts legacy short passwords for login but bounds password length', async () => {
    await expect(pipe.transform({ email: 'user@example.com', password: 'short' }, { type: 'body', metatype: LoginDto })).resolves.toBeInstanceOf(LoginDto);
    await expect(pipe.transform({ email: 'user@example.com', password: 'x'.repeat(129) }, { type: 'body', metatype: LoginDto })).rejects.toMatchObject({ status: 422 });
  });

  it('only allows supported profile fields and permits explicitly clearing a phone', async () => {
    await expect(pipe.transform({ phone: null }, { type: 'body', metatype: UpdateProfileDto })).resolves.toMatchObject({ phone: null });
    for (const body of [{ firstName: null }, { email: 'other@example.com' }, { userId: 'other' }, { roles: ['ADMIN'] }, { password: 'replacement' }]) {
      await expect(pipe.transform(body, { type: 'body', metatype: UpdateProfileDto })).rejects.toMatchObject({ status: 422 });
    }
  });
});
