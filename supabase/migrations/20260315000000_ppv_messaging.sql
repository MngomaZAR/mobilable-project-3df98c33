-- add unlock_price column for direct PPV digital sales
ALTER TABLE public.messages ADD COLUMN unlock_price NUMERIC(10,2);
