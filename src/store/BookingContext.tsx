import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { Booking, BookingStatus } from '../types';
import { useAppData } from './AppDataContext';

type CreateBookingInput = {
  talent_id: string;
  talent_type?: 'photographer' | 'model';
  booking_date: string;
  package_type: string;
  notes?: string;
  base_amount?: number;
  travel_amount?: number;
  start_datetime?: string;
  end_datetime?: string;
  latitude?: number;
  longitude?: number;
  fanout_count?: number;
  intensity_level?: number;
  quote_token?: string | null;
  assignment_state?: 'queued' | 'offered' | 'accepted' | 'expired' | 'cancelled';
  dispatch_request_id?: string | null;
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
  const {
    state,
    loading,
    refresh,
    createBooking: createBookingAppData,
    updateBookingStatus: updateBookingStatusAppData,
  } = useAppData();

  const fetchBookings = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const refreshBookings = fetchBookings;

  const createBooking = useCallback(
    async (payload: CreateBookingInput) =>
      createBookingAppData({
        talent_id: payload.talent_id,
        talent_type: payload.talent_type,
        booking_date: payload.booking_date,
        package_type: payload.package_type,
        notes: payload.notes,
        base_amount: payload.base_amount,
        travel_amount: payload.travel_amount,
        start_datetime: payload.start_datetime,
        end_datetime: payload.end_datetime,
        latitude: payload.latitude,
        longitude: payload.longitude,
        fanout_count: payload.fanout_count,
        intensity_level: payload.intensity_level,
        quote_token: payload.quote_token ?? undefined,
        assignment_state: payload.assignment_state,
        dispatch_request_id: payload.dispatch_request_id,
      }),
    [createBookingAppData]
  );

  const updateBookingStatus = useCallback(
    async (bookingId: string, status: BookingStatus) => {
      await updateBookingStatusAppData(bookingId, status);
    },
    [updateBookingStatusAppData]
  );

  const acceptBooking = useCallback(
    async (bookingId: string) => {
      await updateBookingStatusAppData(bookingId, 'accepted');
    },
    [updateBookingStatusAppData]
  );

  const declineBooking = useCallback(
    async (bookingId: string) => {
      await updateBookingStatusAppData(bookingId, 'declined');
    },
    [updateBookingStatusAppData]
  );

  const value = useMemo<BookingContextValue>(
    () => ({
      bookings: state.bookings,
      loading,
      fetchBookings,
      refreshBookings,
      createBooking,
      updateBookingStatus,
      acceptBooking,
      declineBooking,
    }),
    [
      state.bookings,
      loading,
      fetchBookings,
      refreshBookings,
      createBooking,
      updateBookingStatus,
      acceptBooking,
      declineBooking,
    ]
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (context === undefined) throw new Error('useBooking must be used within a BookingProvider');
  return context;
};
