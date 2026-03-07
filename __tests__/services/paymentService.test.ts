import { createPayfastCheckoutLink } from '../../src/services/paymentService';
import { supabase } from '../../src/config/supabaseClient';

// Mock the supabase client dependency
jest.mock('../../src/config/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

describe('Payment Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return a valid payment URL if Edge Function succeeds', async () => {
    const mockPaymentUrl = 'https://sandbox.payfast.co.za/eng/process?signature=valid_sig&amount=100';
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { paymentUrl: mockPaymentUrl, paymentId: 'pf_123' },
      error: null,
    });

    const result = await createPayfastCheckoutLink({
      bookingId: 'bk_123',
      returnUrl: 'exp://return',
      cancelUrl: 'exp://cancel',
      notifyUrl: 'exp://notify',
    });

    expect(result.paymentUrl).toBe(mockPaymentUrl);
    expect(result.paymentId).toBe('pf_123');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('payfast-handler', expect.any(Object));
  });

  it('should throw an error if the URL is missing a signature', async () => {
    // Missing signature param
    const mockPaymentUrl = 'https://sandbox.payfast.co.za/eng/process?amount=100';
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { paymentUrl: mockPaymentUrl },
      error: null,
    });

    await expect(
      createPayfastCheckoutLink({
        bookingId: 'bk_123',
        returnUrl: 'exp://return',
        cancelUrl: 'exp://cancel',
        notifyUrl: 'exp://notify',
      })
    ).rejects.toThrow('Payment service returned an invalid signature');
  });

  it('should throw an error if the Edge function fails', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'Edge function timeout' },
    });

    await expect(
      createPayfastCheckoutLink({
        bookingId: 'bk_123',
        returnUrl: 'exp://return',
        cancelUrl: 'exp://cancel',
        notifyUrl: 'exp://notify',
      })
    ).rejects.toThrow('Edge function timeout');
  });
});
