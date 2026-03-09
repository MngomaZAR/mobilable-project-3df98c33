import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { createReview, fetchReviewsForUser, ReviewRow } from '../services/reviewService';
import { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'Reviews'>;
type Navigation = StackNavigationProp<RootStackParamList, 'Reviews'>;

const ReviewsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const photographerId = params.photographerId;
  const { state } = useAppData();

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // We check if current user has any completed bookings with this photographer
  const canReview = state.bookings.some(
    (b) => b.photographer_id === photographerId && b.status === 'completed'
  );

  const loadReviews = useCallback(async () => {
    try {
      const data = await fetchReviewsForUser(photographerId);
      setReviews(data);
    } finally {
      setLoading(false);
    }
  }, [photographerId]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  const handleSubmit = async () => {
    if (!canReview) return;
    setSubmitting(true);
    try {
      // Find the booking ID
      const booking = state.bookings.find(b => b.photographer_id === photographerId && b.status === 'completed');
      if (!booking) return;

      const newReview = await createReview({
        bookingId: booking.id,
        photographerId,
        rating,
        comment: comment.trim(),
      });
      setReviews(prev => [newReview, ...prev]);
      setComment('');
      setRating(5);
    } catch (err: any) {
      alert(err.message || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Reviews</Text>
        </View>

        {loading ? (
          <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
        ) : (
          <FlatList
            data={reviews}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Ionicons key={star} name={star <= item.rating ? "star" : "star-outline"} size={14} color="#fbbf24" />
                  ))}
                  <Text style={[styles.date, { color: colors.textMuted }]}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                </View>
                {!!item.comment && <Text style={[styles.commentTxt, { color: colors.text }]}>{item.comment}</Text>}
              </View>
            )}
            ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No reviews yet.</Text>}
          />
        )}

        {canReview && (
          <View style={[styles.form, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.text }]}>Leave a Review</Text>
            <View style={styles.ratingInputRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.starBtn}>
                  <Ionicons name={star <= rating ? "star" : "star-outline"} size={28} color="#fbbf24" />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }]}
              placeholder="Share your experience (optional)"
              placeholderTextColor={colors.textMuted}
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <TouchableOpacity 
              style={[styles.submitBtn, { backgroundColor: colors.accent }, submitting && { opacity: 0.7 }]} 
              onPress={handleSubmit} 
              disabled={submitting}
            >
              <Text style={styles.submitTxt}>{submitting ? 'Submitting...' : 'Submit Review'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  date: { fontSize: 11, marginLeft: 'auto' },
  commentTxt: { fontSize: 14, lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 15 },
  form: { padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16, borderTopWidth: StyleSheet.hairlineWidth },
  formTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  ratingInputRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  starBtn: { padding: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: 'top', marginBottom: 12 },
  submitBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export default ReviewsScreen;
