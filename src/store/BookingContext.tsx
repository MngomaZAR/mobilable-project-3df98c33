import React, { createContext, useCallback, useContext, useState } from 'react';
import { supabase, hasSupabase } from '../config/supabaseClient';
import { Booking, BookingStatus, AppUser } from '../types';
import { logError, formatErrorMessage } from '../utils/errors';
import { useAuth } from './AuthContext';
import { trackEvent } from '../services/analyticsService';
import { uid } from '../utils/id';

type CreateBookingInput = {
  talent_id: string; // Unified talent ID (Model or Photographer)
  talent_type?: 'photographer' | 'model';
  booking_date: string;
  package_type: string;
  notes?: string;
  base_amount?: number;
  travel_amount?: number;
};

type BookingContextValue = {
  bookings: Booking[];
  loading: boolean;
  fetchBookings: () => Promise<void>;
  refreshBookings: () => Promise<void>;
  createBooking: (payload: CreateBookingInput) => Promise<Booking>;
  updateBookingStatus: (bookingId: string, status: BookingStatus) => Promise<void>;
  acceptBooking: (bookingId: string) => Promise<void>;
  declineBooking: (bookingId: string) => Promise<void>;
};

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export const BookingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBookings = useCallback(async () => {
    if (!hasSupabase || !currentUser) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, model_id, photographer:profiles!photographer_id(id, full_name, avatar_url), client:profiles!client_id(id, full_name, avatar_url)`)
        .or(`client_id.eq.${currentUser.id},photographer_id.eq.${currentUser.id},model_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBookings(data.map((row: any) => ({
        id: row.id,
        photographer_id: row.photographer_id,
        model_id: row.model_id ?? null,
        client_id: row.client_id,
        booking_date: row.booking_date,
        package_type: row.package_type,
        notes: row.notes,
        status: row.status,
        created_at: row.created_at,
        total_amount: row.price_total,
        commission_amount: row.commission_amount,
        payout_amount: row.photographer_payout,
        photographer: row.photographer ? { id: row.photographer.id, name: row.photographer.full_name, avatar_url: row.photographer.avatar_url, city: row.photographer.city || null } : undefined,
        client: row.client ? { id: row.client.id, name: row.client.full_name, avatar_url: row.client.avatar_url, city: row.client.city || null } : undefined
      })));
    } catch (err) {
      logError('Booking:fetch', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const createBooking = async (payload: CreateBookingInput) => {
    if (!currentUser) throw new Error('Auth required');
    
    // Mission Critical: Behavioral Science - Haptics on start would go here
    const total = (payload.base_amount || 1200) + (payload.travel_amount || 0);
    const commission = Math.round(total * 0.30);
    const payout = total - commission;
    trackEvent('booking_initiated', { talent_id: payload.talent_id, amount: total });

    try {
      const isModel = payload.talent_type === 'model';
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          client_id: currentUser.id,
          photographer_id: payload.talent_id, // Talent ID (kept for compatibility)
          model_id: isModel ? payload.talent_id : null,
          booking_date: payload.booking_date.split('|')[0]?.trim(),
          package_type: payload.package_type,
          notes: payload.notes,
          status: 'pending',
          price_total: total,
          commission_amount: commission,
          photographer_payout: payout
        })
        .select()
        .single();

      if (error) throw error;
      const newBooking: Booking = {
        id: data.id,
        photographer_id: data.photographer_id,
        model_id: data.model_id ?? null,
        client_id: data.client_id,
        booking_date: data.booking_date,
        package_type: data.package_type,
        notes: data.notes,
        status: data.status,
        created_at: data.created_at,
        total_amount: data.price_total,
        commission_amount: data.commission_amount,
        payout_amount: data.photographer_payout,
        user_latitude: null,
        user_longitude: null
      };
      setBookings(prev => [newBooking, ...prev]);
      trackEvent('booking_completed', { booking_id: data.id, talent_id: data.photographer_id });
      return newBooking;
    } catch (err) {
      logError('Booking:create', err);
      throw err;
    }
  };

  const updateBookingStatus = async (bookingId: string, status: BookingStatus) => {
    try {
      const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);
      if (error) throw error;
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status } : b));
    } catch (err) {
      logError('Booking:updateStatus', err);
      throw err;
    }
  };

  const acceptBooking = async (bookingId: string) => {
    await updateBookingStatus(bookingId, 'accepted');
    trackEvent('booking_accepted', { booking_id: bookingId });
  };

  const declineBooking = async (bookingId: string) => {
    await updateBookingStatus(bookingId, 'declined');
    trackEvent('booking_declined', { booking_id: bookingId });
  };

  const refreshBookings = fetchBookings;

  return (
    <BookingContext.Provider value={{
      bookings,
      loading,
      fetchBookings,
      refreshBookings,
      createBooking,
      updateBookingStatus,
      acceptBooking,
      declineBooking,
    }}>
      {children}
    </BookingContext.Provider>
  );
};

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (context === undefined) throw new Error('useBooking must be used within a BookingProvider');
  return context;
};
