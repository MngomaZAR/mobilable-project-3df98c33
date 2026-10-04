import { environment } from '../src/config/environment';
import { getDefaultPayfastNotifyUrl } from '../src/config/commercePolicy';

jest.mock('../src/config/environment', () => ({ environment: {
  backendProvider: 'api', apiBaseUrl: 'https://api.unit.invalid',
} }));

test('API payment callback does not depend on old Supabase configuration', () => {
  expect(getDefaultPayfastNotifyUrl()).toBe('https://api.unit.invalid/payments/payfast/itn');
});

test('API callback normalizes a trailing slash', () => {
  environment.apiBaseUrl = 'https://api.unit.invalid/';
  expect(getDefaultPayfastNotifyUrl()).toBe('https://api.unit.invalid/payments/payfast/itn');
});

test.each(['http://api.unit.invalid', 'https://user:pass@api.unit.invalid', 'https://api.unit.invalid?token=secret'])('unsafe API callback origin %s is refused', url => {
  environment.apiBaseUrl = url;
  expect(() => getDefaultPayfastNotifyUrl()).toThrow();
});
