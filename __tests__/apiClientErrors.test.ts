import { responseErrorMessage } from '../src/config/apiClient';

describe('API dependency failure messages', () => {
  it('hides backend internals for server failures', () => {
    expect(responseErrorMessage(500, 'Internal Server Error')).toBe(
      'Service is temporarily unavailable. Please try again.'
    );
    expect(responseErrorMessage(503, { message: 'database password leaked' })).toBe(
      'Service is temporarily unavailable. Please try again.'
    );
  });

  it('preserves actionable client validation messages', () => {
    expect(responseErrorMessage(422, 'A valid email address is required.')).toBe(
      'A valid email address is required.'
    );
  });
});
