-- Migration to create the contracts table for legal documents like model releases
CREATE TABLE IF NOT EXISTS public.contracts (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES public.profiles(id),
    client_id UUID NOT NULL REFERENCES public.profiles(id),
    model_id UUID REFERENCES public.profiles(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'expired')),
    contract_type TEXT NOT NULL CHECK (contract_type IN ('model_release', 'shoot_agreement')),
    content TEXT NOT NULL,
    creator_signature TEXT,
    client_signature TEXT,
    model_signature TEXT,
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- Policies
-- 1. Participants can view contracts for their bookings
CREATE POLICY "Participants can view their contracts" ON public.contracts
    FOR SELECT
    USING (
        auth.uid() = creator_id OR 
        auth.uid() = client_id OR 
        auth.uid() = model_id
    );

-- 2. Photographers (creators) can insert contracts
CREATE POLICY "Photographers can create contracts" ON public.contracts
    FOR INSERT
    WITH CHECK (
        auth.uid() = creator_id
    );

-- 3. Participants can update (sign) contracts
CREATE POLICY "Participants can sign contracts" ON public.contracts
    FOR UPDATE
    USING (
        auth.uid() = creator_id OR 
        auth.uid() = client_id OR 
        auth.uid() = model_id
    )
    WITH CHECK (
        auth.uid() = creator_id OR 
        auth.uid() = client_id OR 
        auth.uid() = model_id
    );

-- Grant permissions
GRANT ALL ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
