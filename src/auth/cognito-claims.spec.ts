import {
  assertClaimsFor,
  cognitoIssuer,
  identityFromClaims,
  listClaim,
} from './cognito-claims';

const COGNITO = {
  userPoolId: 'us-east-1_AbCdEfGhI',
  clientIds: ['web-client', 'mobile-client'],
};
const NOW = 1_800_000_000;
const ISSUER =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEfGhI';

describe('listClaim', () => {
  it('lee el arreglo del JWT y el texto que manda el autorizador de HTTP API', () => {
    expect(listClaim({ groups: ['normal', 'premium'] }, 'groups')).toEqual([
      'normal',
      'premium',
    ]);
    expect(listClaim({ groups: '[normal premium]' }, 'groups')).toEqual([
      'normal',
      'premium',
    ]);
    expect(listClaim({ groups: '[premium]' }, 'groups')).toEqual(['premium']);
    expect(listClaim({ groups: 'premium' }, 'groups')).toEqual(['premium']);
    expect(listClaim({ groups: '[]' }, 'groups')).toEqual([]);
    expect(listClaim({}, 'groups')).toEqual([]);
  });
});

describe('identityFromClaims', () => {
  it('saca la identidad del token', () => {
    expect(
      identityFromClaims({
        sub: 'sub-ana',
        email: 'ana@example.com',
        name: ' Ana ',
        'cognito:groups': '[premium]',
        'custom:terminos_version': '2026-01',
      }),
    ).toEqual({
      sub: 'sub-ana',
      email: 'ana@example.com',
      name: 'Ana',
      groups: ['premium'],
      termsVersion: '2026-01',
    });
  });

  it('sin sub no hay identidad', () => {
    expect(() => identityFromClaims({ email: 'ana@example.com' })).toThrow();
  });
});

describe('assertClaimsFor', () => {
  const idToken = {
    sub: 'sub-ana',
    iss: ISSUER,
    token_use: 'id',
    aud: 'web-client',
    exp: String(NOW + 60),
  };

  it('acepta el ID token y el access token de nuestros app clients', () => {
    expect(cognitoIssuer(COGNITO.userPoolId)).toBe(ISSUER);
    expect(() => assertClaimsFor(COGNITO, idToken, NOW)).not.toThrow();
    expect(() =>
      assertClaimsFor(
        COGNITO,
        {
          sub: 'sub-ana',
          iss: ISSUER,
          token_use: 'access',
          client_id: 'mobile-client',
          exp: NOW + 60,
        },
        NOW,
      ),
    ).not.toThrow();
  });

  it('rechaza otro user pool, otro app client, otro token_use o un token vencido', () => {
    const cases = [
      {
        ...idToken,
        iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Otro',
      },
      { ...idToken, aud: 'otro-client' },
      { ...idToken, token_use: 'refresh' },
      { ...idToken, token_use: 'access' }, // sin client_id
      { ...idToken, exp: String(NOW) },
      { ...idToken, exp: 'nunca' },
    ];
    for (const claims of cases) {
      expect(() => assertClaimsFor(COGNITO, claims, NOW)).toThrow();
    }
  });
});
