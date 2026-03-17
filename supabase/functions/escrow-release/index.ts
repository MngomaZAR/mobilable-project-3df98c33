// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PLATFORM_FEE_RATE = 0.20

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid auth token' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }
    const requester = authData.user

    const { booking_id } = await req.json()

    if (!booking_id) {
      return new Response(JSON.stringify({ error: 'booking_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 1: Fetch booking — must be completed, not already paid out
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, status, total_amount, client_id, photographer_id, model_id')
      .eq('id', booking_id)
      .single()

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      })
    }

    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', requester.id)
      .maybeSingle()

    const isAdmin = requesterProfile?.role === 'admin'
    const isBookingProvider = requester.id === booking.photographer_id || requester.id === booking.model_id
    if (!isAdmin && !isBookingProvider) {
      return new Response(JSON.stringify({ error: 'Not authorized to release escrow for this booking' }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 2: Idempotency check — prevent double payout
    if (booking.status === 'paid_out') {
      return new Response(JSON.stringify({ 
        error: 'Booking already paid out',
        booking_id 
      }), {
        status: 409, headers: { 'Content-Type': 'application/json' }
      })
    }

    if (booking.status !== 'completed') {
      return new Response(JSON.stringify({ 
        error: `Cannot release escrow — booking status is ${booking.status}` 
      }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const total = Number(booking.total_amount)
    if (!total || total <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid booking amount' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 3: Calculate splits
    const platform_fee = Number((total * PLATFORM_FEE_RATE).toFixed(2))
    const payout_pool = Number((total - platform_fee).toFixed(2))

    // Step 4: Determine providers and split payout_pool
    const providers: { user_id: string; source_type: string }[] = []

    if (booking.photographer_id) {
      providers.push({ 
        user_id: booking.photographer_id, 
        source_type: 'booking' 
      })
    }
    if (booking.model_id) {
      providers.push({ 
        user_id: booking.model_id, 
        source_type: 'booking' 
      })
    }

    if (providers.length === 0) {
      return new Response(JSON.stringify({ error: 'No providers found on booking' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const per_provider = Number((payout_pool / providers.length).toFixed(2))

    // Step 5: Insert earnings rows for each provider
    const earningsRows = providers.map(p => ({
      user_id: p.user_id,
      source_type: p.source_type,
      source_id: booking_id,
      gross_amount: per_provider / (1 - PLATFORM_FEE_RATE),
      platform_fee: platform_fee / providers.length,
      amount: per_provider,
      payout_rate: 1 - PLATFORM_FEE_RATE
    }))

    const { error: earningsError } = await supabase
      .from('earnings')
      .insert(earningsRows)

    if (earningsError) {
      console.error('Earnings insert error:', earningsError)
      return new Response(JSON.stringify({ error: 'Failed to create earnings records' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 6: Mark booking as paid_out — atomic status update
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'paid_out' })
      .eq('id', booking_id)
      .eq('status', 'completed') // extra guard: only update if still 'completed'

    if (updateError) {
      console.error('Booking update error:', updateError)
      return new Response(JSON.stringify({ error: 'Failed to update booking status' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 7: Log to system_event_logs
    await supabase.from('system_event_logs').insert({
      source: 'escrow-release',
      level: 'info',
      message: `Escrow released for booking ${booking_id}`,
      metadata: { booking_id, total, platform_fee, payout_pool, provider_count: providers.length }
    })

    return new Response(JSON.stringify({
      success: true,
      booking_id,
      total,
      platform_fee,
      payout_pool,
      per_provider,
      providers: providers.length
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('escrow-release error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
