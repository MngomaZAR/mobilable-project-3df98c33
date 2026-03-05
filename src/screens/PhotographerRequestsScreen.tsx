import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useAppData } from '../store/AppDataContext';

type Navigation = StackNavigationProp<RootStackParamList, 'BookingDetail'>;

const PhotographerRequestsScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { state, currentUser } = useAppData();
  const requests = useMemo(
    () =>
      state.bookings.filter(
        (booking) => booking.photographerId === currentUser?.id && booking.status !== 'reviewed'
      ),
    [currentUser?.id, state.bookings]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Requests</Text>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('BookingDetail', { bookingId: item.id })}
          >
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.package}
            </Text>
            <Text style={styles.cardMeta}>{item.date}</Text>
            <Text style={styles.cardMeta}>Status: {item.status}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No incoming requests right now.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7fb', padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  listContent: { paddingBottom: 80 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: '#0f172a', fontWeight: '700' },
  cardMeta: { color: '#475569', marginTop: 4 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 24 },
});

export default PhotographerRequestsScreen;
