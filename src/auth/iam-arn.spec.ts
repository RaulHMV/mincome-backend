import { roleKeyOfAssumedRoleArn, roleKeyOfRoleArn } from './iam-arn';

describe('ARN de roles IAM', () => {
  it('compara cuenta y nombre del rol, sin el path ni la sesión', () => {
    expect(
      roleKeyOfRoleArn('arn:aws:iam::123456789012:role/mincome-ai-wrapper'),
    ).toBe('123456789012/mincome-ai-wrapper');
    expect(
      roleKeyOfRoleArn(
        'arn:aws:iam::123456789012:role/service-role/mincome-ai-wrapper',
      ),
    ).toBe('123456789012/mincome-ai-wrapper');
    expect(
      roleKeyOfAssumedRoleArn(
        'arn:aws:sts::123456789012:assumed-role/mincome-ai-wrapper/mincome-ai-wrapper-fn',
      ),
    ).toBe('123456789012/mincome-ai-wrapper');
  });

  it('no confunde usuarios IAM ni ARN mal formados con roles', () => {
    expect(
      roleKeyOfAssumedRoleArn(
        'arn:aws:iam::123456789012:user/mincome-ai-wrapper',
      ),
    ).toBeNull();
    expect(
      roleKeyOfAssumedRoleArn(
        'arn:aws:sts::123456789012:assumed-role/sin-sesion',
      ),
    ).toBeNull();
    expect(roleKeyOfRoleArn('mincome-ai-wrapper')).toBeNull();
  });
});
