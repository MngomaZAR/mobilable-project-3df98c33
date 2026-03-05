import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../config/supabaseClient';
import { EventPackage, Photographer, PRICING_CONFIG } from '../types';
import { quoteEventPackage, quotePaparazziSession } from '../utils/pricing';
import { formatCurrency, getCurrencyForLocale } from '../utils/format';

type StatCard = {
  label: string;
  count: number | null;
  error?: string;
};

type Ticket = {
  id: string;
  subject: string;
  category: string;
  status: string;
  created_at: string;
  created_by: string;
};

type ReportRow = {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
  created_by: string;
};

type PaymentRow = {
  id: string;
  booking_id: string | null;
  status: string;
  amount: number | null;
  created_at: string;
};

type BookingRow = {
  id: string;
  status: string;
  requested_date: string | null;
  price_total: number | null;
  currency: string | null;
  created_at: string;
};

const AdminDashboardScreen: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatCard[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [samplePhotographer, setSamplePhotographer] = useState<Photographer | null>(null);
  const localeCurrency = useMemo(() => getCurrencyForLocale(), []);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [recentPayments, setRecentPayments] = useState<PaymentRow[]>([]);
  const [recentBookings, setRecentBookings] = useState<BookingRow[]>([]);

  const fetchCount = useCallback(async (table: string): Promise<StatCard> => {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
    return {
      label: table,
      count: error ? null : count ?? 0,
      error: error?.message,
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all([
      fetchCount('profiles'),
      fetchCount('photographers'),
      fetchCount('posts'),
      fetchCount('bookings'),
      fetchCount('payments'),
      fetchCount('conversations'),
      fetchCount('messages'),
    ]);
    setStats(results);
    const { data: ratings } = await supabase.from('photographers').select('id, rating, latitude, longitude');
    if (ratings && ratings.length > 0) {
      const total = ratings.reduce((sum, row: any) => sum + Number(row.rating ?? 0), 0);
      setAvgRating(total / ratings.length);
      const base = ratings[0];
      setSamplePhotographer({
        id: base.id,
        name: 'Sample photographer',
        style: '',
        location: 'South Africa',
        latitude: base.latitude ?? -26.2041,
        longitude: base.longitude ?? 28.0473,
        avatar: '',
        bio: '',
        rating: base.rating ?? 4.5,
        priceRange: 'R1500',
        tags: [],
      });
    } else {
      setAvgRating(null);
      setSamplePhotographer(null);
    }
    const { data: ticketRows } = await supabase
      .from('support_tickets')
      .select('id, subject, category, status, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(6);
    setTickets(ticketRows ?? []);

    const { data: reportRows } = await supabase
      .from('reports')
      .select('id, target_type, target_id, reason, status, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(6);
    setReports(reportRows ?? []);

    const { data: paymentRows } = await supabase
      .from('payments')
      .select('id, booking_id, status, amount, created_at')
      .order('created_at', { ascending: false })
      .limit(6);
    setRecentPayments(paymentRows ?? []);

    const { data: bookingRows } = await supabase
      .from('bookings')
      .select('id, status, requested_date, price_total, currency, created_at')
      .order('created_at', { ascending: false })
      .limit(6);
    setRecentBookings(bookingRows ?? []);

    setLoading(false);
  }, [fetchCount]);

  const updateTicketStatus = useCallback(async (ticketId: string, status: string) => {
    await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
    setTickets((prev) => prev.map((ticket) => (ticket.id === ticketId ? { ...ticket, status } : ticket)));
  }, []);

  const updateReportStatus = useCallback(async (reportId: string, status: string) => {
    await supabase.from('reports').update({ status }).eq('id', reportId);
    setReports((prev) => prev.map((report) => (report.id === reportId ? { ...report, status } : report)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sampleEvent = useMemo<EventPackage>(() => PRICING_CONFIG.eventPackages[0], []);
  const samplePaparazziQuote = useMemo(() => {
    if (!samplePhotographer) return null;
    return quotePaparazziSession(samplePhotographer, 5, 4, localeCurrency);
  }, [samplePhotographer, localeCurrency]);
  const sampleEventQuote = useMemo(() => {
    if (!samplePhotographer) return null;
    return quoteEventPackage(samplePhotographer, sampleEvent, 8, localeCurrency);
  }, [sampleEvent, samplePhotographer, localeCurrency]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>Admin overview</Text>
            <Text style={styles.title}>Platform health</Text>
            <Text style={styles.subtitle}>Snapshot of core tables and activity.</Text>
          </View>
          <TouchableOpacity style={styles.refresh} onPress={load} disabled={loading}>
            <Text style={styles.refreshText}>{loading ? 'Loading...' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#0f172a" />
            <Text style={styles.loadingText}>Fetching dashboard stats...</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.card}>
                <Text style={styles.cardLabel}>{stat.label}</Text>
                <Text style={styles.cardValue}>{stat.count ?? '--'}</Text>
                {stat.error ? <Text style={styles.cardError}>{stat.error}</Text> : null}
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Average photographer rating</Text>
          <Text style={styles.cardValue}>{avgRating ? avgRating.toFixed(2) : '--'}</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Pricing config</Text>
          <Text style={styles.cardMeta}>Commission: {Math.round(PRICING_CONFIG.commissionRate * 100)}%</Text>
          <Text style={styles.cardMeta}>
            Paparazzi base: {PRICING_CONFIG.currency} {PRICING_CONFIG.paparazzi.basePerPhoto.toFixed(2)} per photo
          </Text>
          <Text style={styles.cardMeta}>
            Distance fee: {PRICING_CONFIG.currency} {PRICING_CONFIG.paparazzi.distanceFeePerKm.toFixed(2)} per km
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Sample quotes</Text>
          {samplePaparazziQuote ? (
            <Text style={styles.cardMeta}>
              Paparazzi (4 photos, 5km): {formatCurrency(samplePaparazziQuote.total, samplePaparazziQuote.currency)}
            </Text>
          ) : null}
          {sampleEventQuote ? (
            <Text style={styles.cardMeta}>
              {sampleEvent.label} (8km): {formatCurrency(sampleEventQuote.total, sampleEventQuote.currency)}
            </Text>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Support tickets</Text>
          {tickets.length === 0 ? (
            <Text style={styles.cardMeta}>No open tickets.</Text>
          ) : (
            tickets.map((ticket) => (
              <View key={ticket.id} style={styles.listRow}>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>{ticket.subject}</Text>
                  <Text style={styles.listMeta}>
                    {ticket.category} · {new Date(ticket.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.actionColumn}>
                  <Text style={styles.statusPill}>{ticket.status}</Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => updateTicketStatus(ticket.id, 'in_progress')}
                    >
                      <Text style={styles.actionText}>In progress</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => updateTicketStatus(ticket.id, 'resolved')}
                    >
                      <Text style={styles.actionText}>Resolve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Reports</Text>
          {reports.length === 0 ? (
            <Text style={styles.cardMeta}>No reports yet.</Text>
          ) : (
            reports.map((report) => (
              <View key={report.id} style={styles.listRow}>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>
                    {report.target_type} · {report.reason}
                  </Text>
                  <Text style={styles.listMeta}>
                    {new Date(report.created_at).toLocaleDateString()} · {report.target_id}
                  </Text>
                </View>
                <View style={styles.actionColumn}>
                  <Text style={styles.statusPill}>{report.status}</Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => updateReportStatus(report.id, 'reviewing')}
                    >
                      <Text style={styles.actionText}>Review</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => updateReportStatus(report.id, 'resolved')}
                    >
                      <Text style={styles.actionText}>Resolve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Recent bookings</Text>
          {recentBookings.length === 0 ? (
            <Text style={styles.cardMeta}>No recent bookings.</Text>
          ) : (
            recentBookings.map((booking) => (
              <View key={booking.id} style={styles.listRow}>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>Booking {booking.id.slice(0, 6)}</Text>
                  <Text style={styles.listMeta}>
                    {booking.requested_date ?? 'Date TBD'} · {booking.status}
                  </Text>
                </View>
                <Text style={styles.amountText}>
                  {formatCurrency(booking.price_total ?? 0, booking.currency ?? localeCurrency)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.cardLabel}>Recent payments</Text>
          {recentPayments.length === 0 ? (
            <Text style={styles.cardMeta}>No recent payments.</Text>
          ) : (
            recentPayments.map((payment) => (
              <View key={payment.id} style={styles.listRow}>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>Payment {payment.id.slice(0, 6)}</Text>
                  <Text style={styles.listMeta}>
                    {new Date(payment.created_at).toLocaleDateString()} · {payment.status}
                  </Text>
                </View>
                <Text style={styles.amountText}>
                  {formatCurrency(payment.amount ?? 0, localeCurrency)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    padding: 16,
    paddingBottom: 120,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  eyebrow: {
    color: '#0f172a',
    fontWeight: '800',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    color: '#475569',
    marginTop: 4,
  },
  refresh: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  refreshText: {
    color: '#fff',
    fontWeight: '700',
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 10,
    color: '#475569',
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  card: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    margin: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  cardLabel: {
    color: '#475569',
    fontWeight: '700',
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardError: {
    color: '#b45309',
    marginTop: 6,
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  listText: {
    flex: 1,
    marginRight: 10,
  },
  listTitle: {
    fontWeight: '700',
    color: '#0f172a',
  },
  listMeta: {
    color: '#64748b',
    marginTop: 2,
  },
  actionColumn: {
    alignItems: 'flex-end',
    gap: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
  },
  actionText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
  statusPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    textTransform: 'uppercase',
  },
  amountText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  cardMeta: {
    color: '#475569',
    marginTop: 4,
    fontWeight: '600',
  },
});

export default AdminDashboardScreen;
