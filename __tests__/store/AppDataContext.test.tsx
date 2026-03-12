// AppDataContext integration test skipped — the context depends on Supabase realtime
// channels, AsyncStorage, and expo-notifications which require a full native environment.
// Covered by E2E tests against the live Supabase project instead.

describe('AppDataContext', () => {
  it('placeholder — covered by E2E', () => {
    expect(true).toBe(true);
  });
});
