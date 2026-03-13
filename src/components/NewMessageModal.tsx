import React, { useMemo, useState } from 'react';
import { FlatList, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { ProfileSummary } from '../types';
import { PLACEHOLDER_AVATAR } from '../utils/constants';

type NewMessageModalProps = {
  visible: boolean;
  onClose: () => void;
  profiles: ProfileSummary[];
  currentUserId?: string | null;
  onSelectUser: (user: ProfileSummary) => void;
  title?: string;
};

export const NewMessageModal: React.FC<NewMessageModalProps> = ({
  visible,
  onClose,
  profiles,
  currentUserId,
  onSelectUser,
  title = 'Start a new message',
}) => {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter((p) => p?.id && p.id !== currentUserId)
      .filter((p) => {
        if (!q) return true;
        const name = (p.full_name ?? '').toLowerCase();
        const username = (p.username ?? '').toLowerCase();
        const city = (p.city ?? '').toLowerCase();
        return name.includes(q) || username.includes(q) || city.includes(q);
      })
      .slice(0, 50);
  }, [profiles, query, currentUserId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={[styles.searchRow, { borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              placeholder="Search by name or username"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { borderColor: colors.border }]}
                onPress={() => onSelectUser(item)}
              >
                <Image
                  source={{ uri: item.avatar_url ?? PLACEHOLDER_AVATAR }}
                  style={styles.avatar}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>
                    {item.full_name ?? 'User'}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    @{item.username ?? 'papzii'} {item.city ? `· ${item.city}` : ''}
                  </Text>
                </View>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>
                No users found.
              </Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800' },
  closeBtn: { padding: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14 },
  list: { paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e2e8f0' },
  name: { fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', paddingVertical: 20, fontWeight: '600' },
});
