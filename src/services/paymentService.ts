import { supabase } from "../config/supabaseClient";

type CreatePayfastCheckoutInput = {
  bookingId: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
};

type CreatePayfastCheckoutResult = {
  paymentUrl: string;
  paymentId?: string;
};

const getSignedUrlSignature = (paymentUrl: string) => {
  const parsed = new URL(paymentUrl);
  return parsed.searchParams.get("signature");
};

const validateSignedPayfastUrl = (paymentUrl: string) => {
  if (!paymentUrl || !/^https?:\/\//i.test(paymentUrl)) {
    throw new Error("Payment service returned an invalid checkout URL.");
  }

  const signature = getSignedUrlSignature(paymentUrl);
  if (!signature || signature.includes("[object Object]")) {
    throw new Error(
      "Payment service returned an invalid signature. Update your PayFast server configuration."
    );
  }
};

export const createPayfastCheckoutLink = async ({
  bookingId,
  returnUrl,
  cancelUrl,
  notifyUrl,
}: CreatePayfastCheckoutInput): Promise<CreatePayfastCheckoutResult> => {
  const { data, error } = await supabase.functions.invoke("payfast-handler", {
    body: {
      booking_id: bookingId,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: notifyUrl,
    },
  });

  if (error) {
    throw new Error(error.message || "Unable to sign the payment request.");
  }

  const paymentUrl = data?.paymentUrl as string | undefined;
  if (!paymentUrl) {
    throw new Error("Payment service did not return a checkout URL.");
  }

  validateSignedPayfastUrl(paymentUrl);
  return {
    paymentUrl,
    paymentId: typeof data?.paymentId === "string" ? data.paymentId : undefined,
  };
};
