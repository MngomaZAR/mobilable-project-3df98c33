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
  booking_id: string | null;
  customer_id: string | null;
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
  Deno.env.get("PAYFAST_BASE_URL")?.trim() || "https://www.payfast.co.za";
const payfastBaseUrl = payfastBaseUrlRaw.replace(/\/eng\/process\/?$/i, "");
const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID")?.trim() || "";
const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY")?.trim() || "";
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
  // PAYFAST IMPORTANT: Variable order must match attribute description order in documentation.
  // DO NOT use alphabetical sorting for Custom Integration signatures.
  const orderedKeys = [
    "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", 
    "fica_idnumber", "name_first", "name_last", "email_address", "cell_number",
    "m_payment_id", "amount", "item_name", "item_description",
    "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
    "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
    "email_confirmation", "confirmation_address", "payment_method",
    "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles"
  ];

  const payloadSegments: string[] = [];

  for (const key of orderedKeys) {
    const value = params[key];
    if (value !== undefined && value !== null && `${value}`.trim().length > 0) {
      payloadSegments.push(`${key}=${toPayfastValue(`${value}`.trim())}`);
    }
  }

  const payload = payloadSegments.join("&");

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

const asNumber = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validatePayfastConfig = () => {
  if (!merchantId || !merchantKey || !passphrase) {
    return "Missing PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, or PAYFAST_PASSPHRASE";
  }
  return null;
};

const loadOrCreatePayment = async (
  bookingId: string,
  customerId: string | null,
  description: string,
  fallbackAmount = 1200
) => {
  const { data: existing, error: loadError } = await supabase
    .from("payments")
    .select("id, booking_id, customer_id, amount, currency, status")
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
    .select("id, booking_id, customer_id, amount, currency, status")
    .single<PaymentRow>();

  if (createError) throw createError;
  return created;
};

const createStandalonePayment = async (
  customerId: string | null,
  amount: number,
  description: string,
  referenceType: string,
  referenceId: string | null
) => {
  const { data: created, error } = await supabase
    .from("payments")
    .insert({
      booking_id: null,
      customer_id: customerId,
      description,
      amount,
      currency: "ZAR",
      provider: "payfast",
      status: "pending",
      provider_payload: {
        reference_type: referenceType,
        reference_id: referenceId,
      },
    })
    .select("id, booking_id, customer_id, amount, currency, status")
    .single<PaymentRow>();

  if (error) throw error;
  return created;
};

const handleCreateCheckoutLink = async (req: Request) => {
  const configError = validatePayfastConfig();
  if (configError) {
    return jsonResponse(500, { error: configError });
  }

  const payload = (await req.json().catch(() => null)) as
    | {
        type?: string;
        booking_id?: string;
        tip_id?: string;
        user_id?: string;
        amount?: number | string;
        credits?: number | string;
        item_name?: string;
        return_url?: string;
        cancel_url?: string;
        notify_url?: string;
      }
    | null;

  const bookingId = payload?.booking_id?.trim();
  const tipId = payload?.tip_id?.trim();
  const checkoutType = payload?.type?.trim().toLowerCase();

  let itemName = payload?.item_name?.trim() || "Papzi checkout";
  let amount = 1200;
  let payment: PaymentRow;
  const customFields: Record<string, string> = {};

  if (bookingId) {
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

    itemName = booking.package_type?.trim() || "Photography booking";
    payment = await loadOrCreatePayment(
      bookingId,
      booking.client_id ?? null,
      itemName
    );
    amount = Number.isFinite(payment.amount ?? NaN) ? Number(payment.amount) : 1200;
    customFields.custom_str1 = "booking";
    customFields.custom_str2 = bookingId;
  } else if (tipId) {
    const { data: tip, error: tipError } = await supabase
      .from("tips")
      .select("id, sender_id, amount")
      .eq("id", tipId)
      .maybeSingle();
    if (tipError) return jsonResponse(500, { error: tipError.message });
    if (!tip) return jsonResponse(404, { error: "Tip not found" });

    amount = Number.isFinite(Number(tip.amount))
      ? Number(tip.amount)
      : Number(payload?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse(400, { error: "Invalid tip amount" });
    }

    itemName = payload?.item_name?.trim() || "Creator tip";
    payment = await createStandalonePayment(
      tip.sender_id ?? null,
      amount,
      itemName,
      "tip",
      tipId
    );
    customFields.custom_str1 = "tip";
    customFields.custom_str2 = tipId;
  } else if (checkoutType === "credits") {
    const parsedAmount = Number(payload?.amount ?? 0);
    const parsedCredits = Number(payload?.credits ?? 0);
    const targetUserId = payload?.user_id?.trim() || null;
    if (!targetUserId) return jsonResponse(400, { error: "user_id is required for credits checkout" });
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return jsonResponse(400, { error: "Invalid amount for credits checkout" });
    }
    if (!Number.isFinite(parsedCredits) || parsedCredits <= 0) {
      return jsonResponse(400, { error: "Invalid credits quantity" });
    }

    amount = parsedAmount;
    itemName = payload?.item_name?.trim() || `Papzi Credits - ${parsedCredits}`;
    payment = await createStandalonePayment(
      targetUserId,
      amount,
      itemName,
      "credits",
      targetUserId
    );
    customFields.custom_str1 = "credits";
    customFields.custom_str2 = targetUserId;
    customFields.custom_str3 = String(Math.floor(parsedCredits));
  } else {
    return jsonResponse(400, { error: "booking_id, tip_id, or type=credits is required" });
  }

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
    ...customFields,
  };

  const signature = createSignature(params, passphrase);
  const urlParams = new URLSearchParams({
    ...params,
    signature,
  });
  const paymentUrl = `${payfastBaseUrl}/eng/process?${urlParams.toString()}`;

  return jsonResponse(200, {
    paymentUrl,
    paymentId: payment.id,
    bookingId: bookingId ?? null,
    tipId: tipId ?? null,
    checkoutType: customFields.custom_str1 ?? "booking",
  });
};

const handleItn = async (req: Request) => {
  const configError = validatePayfastConfig();
  if (configError) {
    console.error("payfast-handler: config error", configError);
    return textOk("OK");
  }

  // PayFast requires a plain 200 response body/header to acknowledge ITN delivery.
  const body = await req.text().catch(() => "");
  const payload = Object.fromEntries(new URLSearchParams(body).entries());

  const remoteIp = (req.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim();
  if (allowedIps.length > 0 && remoteIp && !allowedIps.includes(remoteIp)) {
    console.warn("payfast-handler: rejected ITN by IP allowlist", remoteIp);
    return textOk("OK");
  }

  const receivedSignature = payload.signature || "";
  // For ITN, PayFast sends all variables excluding the signature.
  // We must re-create the signature using all received fields in the correct order.
  const expectedSignature = createSignature(payload, passphrase);
  
  if (!receivedSignature || expectedSignature.toLowerCase() !== receivedSignature.toLowerCase()) {
    console.warn("payfast-handler: invalid signature", { receivedSignature, expectedSignature });
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
    .select("id, booking_id, customer_id, amount, currency, status")
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

  if (payment.booking_id) {
    const { error: updateBookingError } = await supabase
      .from("bookings")
      .update({ status: "accepted", updated_at: now })
      .eq("id", payment.booking_id);

    if (updateBookingError) {
      console.error("payfast-handler: booking update failed", updateBookingError.message);
      return textOk("OK");
    }
  }

  const checkoutType = (payload.custom_str1 || "").toLowerCase();
  if (checkoutType === "tip" && payload.custom_str2) {
    const { error: updateTipError } = await supabase
      .from("tips")
      .update({
        status: "completed",
        payment_reference: payload.pf_payment_id || payment.id,
      })
      .eq("id", payload.custom_str2);

    if (updateTipError) {
      console.error("payfast-handler: tip update failed", updateTipError.message);
      return textOk("OK");
    }
  }

  if (checkoutType === "credits" && payload.custom_str2) {
    const creditsAmount = Number.parseInt(payload.custom_str3 || "", 10);
    const safeCreditAmount = Number.isFinite(creditsAmount) && creditsAmount > 0
      ? creditsAmount
      : Math.max(1, Math.floor(receivedAmount));

    const { error: creditAdjustError } = await supabase.rpc("credits_adjust_for_user", {
      p_user_id: payload.custom_str2,
      p_amount: safeCreditAmount,
      p_reason: "Credits top-up",
      p_ref_type: "credits_topup",
      p_ref_id: payment.id,
    });

    if (creditAdjustError) {
      console.error("payfast-handler: credits wallet update failed", creditAdjustError.message);
      return textOk("OK");
    }
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
