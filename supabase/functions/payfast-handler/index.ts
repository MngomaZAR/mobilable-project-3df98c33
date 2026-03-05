// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import md5 from "npm:blueimp-md5@2.19.0";

type BookingRow = {
  id: string;
  package_type: string | null;
  client_id: string | null;
};

type PaymentRow = {
  id: string;
  booking_id: string;
  amount: number | null;
  currency: string | null;
  status: string | null;
};

type JsonRecord = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};

const textHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/plain; charset=utf-8",
};

const payfastBaseUrlRaw =
  Deno.env.get("PAYFAST_BASE_URL")?.trim() || "https://sandbox.payfast.co.za";
const payfastBaseUrl = payfastBaseUrlRaw.replace(/\/eng\/process\/?$/i, "");
const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID")?.trim() || "10046407";
const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY")?.trim() || "zuimv2w7udhu3";
const passphrase = Deno.env.get("PAYFAST_PASSPHRASE")?.trim() || "";
const allowedIps = (Deno.env.get("PAYFAST_ITN_ALLOWED_IPS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

const toPayfastValue = (value: string) =>
  encodeURIComponent(value).replace(/%20/g, "+");

const createSignature = (params: Record<string, string>, providedPassphrase?: string) => {
  const payload = Object.entries(params)
    .filter(([key, value]) => key !== "signature" && value !== undefined && value !== null && `${value}`.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${toPayfastValue(`${value}`)}`)
    .join("&");

  const fullPayload =
    providedPassphrase && providedPassphrase.length > 0
      ? `${payload}&passphrase=${toPayfastValue(providedPassphrase)}`
      : payload;

  return md5(fullPayload);
};

const jsonResponse = (status: number, body: JsonRecord) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const textOk = (message = "OK") =>
  new Response(message, { status: 200, headers: textHeaders });

const validateItnWithPayfast = async (encodedBody: string): Promise<boolean> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${payfastBaseUrl}/eng/query/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodedBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn("payfast-handler: ITN validation HTTP error", response.status);
      return false;
    }

    const responseText = (await response.text()).trim().toUpperCase();
    return responseText === "VALID";
  } catch (error) {
    console.warn("payfast-handler: ITN validation request failed", error);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

const asNumber = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const loadOrCreatePayment = async (
  bookingId: string,
  customerId: string | null,
  description: string,
  fallbackAmount = 1200
) => {
  const { data: existing, error: loadError } = await supabase
    .from("payments")
    .select("id, booking_id, amount, currency, status")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentRow>();

  if (loadError) throw loadError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from("payments")
    .insert({
      booking_id: bookingId,
      customer_id: customerId,
      description,
      amount: fallbackAmount,
      currency: "ZAR",
      provider: "payfast",
      status: "pending",
    })
    .select("id, booking_id, amount, currency, status")
    .single<PaymentRow>();

  if (createError) throw createError;
  return created;
};

const handleCreateCheckoutLink = async (req: Request) => {
  const payload = (await req.json().catch(() => null)) as
    | {
        booking_id?: string;
        return_url?: string;
        cancel_url?: string;
        notify_url?: string;
      }
    | null;

  const bookingId = payload?.booking_id?.trim();
  if (!bookingId) {
    return jsonResponse(400, { error: "booking_id is required" });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, package_type, client_id")
    .eq("id", bookingId)
    .maybeSingle<BookingRow>();

  if (bookingError) {
    return jsonResponse(500, { error: bookingError.message });
  }
  if (!booking) {
    return jsonResponse(404, { error: "Booking not found" });
  }

  const itemName = booking.package_type?.trim() || "Photography booking";
  const payment = await loadOrCreatePayment(
    bookingId,
    booking.client_id ?? null,
    itemName
  );
  const amount = Number.isFinite(payment.amount ?? NaN)
    ? Number(payment.amount)
    : 1200;

  const params: Record<string, string> = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: payload?.return_url?.trim() || "",
    cancel_url: payload?.cancel_url?.trim() || "",
    notify_url:
      payload?.notify_url?.trim() ||
      `${supabaseUrl}/functions/v1/payfast-handler/notify`,
    m_payment_id: payment.id,
    amount: amount.toFixed(2),
    item_name: itemName,
    custom_str2: bookingId,
  };

  const signature = createSignature(params, passphrase);
  const urlParams = new URLSearchParams({ ...params, signature });
  const paymentUrl = `${payfastBaseUrl}/eng/process?${urlParams.toString()}`;

  return jsonResponse(200, { paymentUrl, paymentId: payment.id, bookingId });
};

const handleItn = async (req: Request) => {
  // PayFast requires a plain 200 response body/header to acknowledge ITN delivery.
  const body = await req.text().catch(() => "");
  const payload = Object.fromEntries(new URLSearchParams(body).entries());

  const remoteIp = (req.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim();
  if (allowedIps.length > 0 && (!remoteIp || !allowedIps.includes(remoteIp))) {
    console.warn("payfast-handler: rejected ITN by IP allowlist", remoteIp);
    return textOk("OK");
  }

  const incomingMerchantId = (payload.merchant_id || "").trim();
  if (!incomingMerchantId || incomingMerchantId !== merchantId) {
    console.warn("payfast-handler: merchant mismatch");
    return textOk("OK");
  }

  const receivedSignature = payload.signature || "";
  const expectedSignature = createSignature(payload, passphrase);
  if (!receivedSignature || expectedSignature !== receivedSignature) {
    console.warn("payfast-handler: invalid signature");
    return textOk("OK");
  }

  const itnValidated = await validateItnWithPayfast(body);
  if (!itnValidated) {
    console.warn("payfast-handler: ITN validation failed");
    return textOk("OK");
  }

  if ((payload.payment_status || "").toUpperCase() !== "COMPLETE") {
    console.warn("payfast-handler: payment not complete");
    return textOk("OK");
  }

  const paymentId = payload.m_payment_id;
  if (!paymentId) {
    console.warn("payfast-handler: missing m_payment_id");
    return textOk("OK");
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, booking_id, amount, currency, status")
    .eq("id", paymentId)
    .maybeSingle<PaymentRow>();

  if (paymentError) {
    console.error("payfast-handler: failed payment lookup", paymentError.message);
    return textOk("OK");
  }
  if (!payment) {
    console.warn("payfast-handler: payment not found", paymentId);
    return textOk("OK");
  }

  const paymentStatus = (payment.status || "").toLowerCase();
  if (["completed", "paid", "complete"].includes(paymentStatus)) {
    // Duplicate transaction protection: idempotent success acknowledgement.
    return textOk("OK");
  }

  const receivedAmount = asNumber(payload.amount_gross);
  const expectedAmount = Number.isFinite(payment.amount ?? NaN)
    ? Number(payment.amount)
    : null;
  if (receivedAmount === null || expectedAmount === null) {
    console.warn("payfast-handler: missing amount for verification");
    return textOk("OK");
  }
  if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
    console.warn("payfast-handler: amount mismatch", { receivedAmount, expectedAmount });
    return textOk("OK");
  }

  const now = new Date().toISOString();
  const { error: updatePaymentError } = await supabase
    .from("payments")
    .update({ status: "completed", updated_at: now })
    .eq("id", payment.id);

  if (updatePaymentError) {
    console.error("payfast-handler: payment update failed", updatePaymentError.message);
    return textOk("OK");
  }

  const { error: updateBookingError } = await supabase
    .from("bookings")
    .update({ status: "accepted", updated_at: now })
    .eq("id", payment.booking_id);

  if (updateBookingError) {
    console.error("payfast-handler: booking update failed", updateBookingError.message);
    return textOk("OK");
  }

  return textOk("OK");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const pathname = new URL(req.url).pathname.toLowerCase();
    if (pathname.endsWith("/notify")) {
      return await handleItn(req);
    }
    return await handleCreateCheckoutLink(req);
  } catch (error) {
    console.error("payfast-handler: unexpected error", error);
    return jsonResponse(500, { error: "Internal Server Error" });
  }
});
