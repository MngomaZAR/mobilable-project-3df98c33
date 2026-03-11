import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Image, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { fetchCreatorMedia, unlockMediaAsset } from '../services/mediaService';
import { MediaAsset } from '../types';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 3;
const SPACING = 2;
const ITEM_SIZE = (width - SPACING * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

type RouteParams = { MediaLibrary: { creatorId: string, title?: string } };

export const MediaLibraryScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'MediaLibrary'>>();
  const creatorId = route.params?.creatorId;
  const pageTitle = route.params?.title || 'Media Library';
  const { state } = useAppData();

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);

  useEffect(() => {
    if (creatorId) {
      fetchCreatorMedia(creatorId)
        .then(setAssets)
        .catch(console.warn)
        .finally(() => setLoading(false));
    } else {
        setLoading(false);
    }
  }, [creatorId]);

  const handleAssetPress = (asset: MediaAsset) => {
    if (asset.is_locked && !asset.full_url) {
      Alert.alert(
        'Unlock Media',
        `Unlock this premium content for R${asset.price_zar}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Unlock', 
            onPress: () => handleUnlock(asset.id),
            // @ts-ignore
            style: 'default' 
          }
        ]
      );
    } else {
      setSelectedAsset(asset);
    }
  };

  const handleUnlock = async (id: string) => {
    setUnlockingId(id);
    try {
      const fullUrl = await unlockMediaAsset(id);
      setAssets(prev => prev.map(a => a.id === id ? { ...a, is_locked: false, full_url: fullUrl } : a));
      if (Platform.OS === 'web') alert('Content unlocked successfully!');
    } catch (e: any) {
      if (Platform.OS === 'web') alert(e.message);
      else Alert.alert('Error', e.message);
    } finally {
      setUnlockingId(null);
    }
  };

  const renderItem = ({ item }: { item: MediaAsset }) => {
    const isLocked = item.is_locked && !item.full_url;
    return (
      <TouchableOpacity 
        style={[styles.item, { backgroundColor: colors.card }]}
        onPress={() => handleAssetPress(item)}
        activeOpacity={0.8}
      >
        <Image 
          source={{ uri: item.preview_url || item.full_url || '' }} 
          style={styles.image}
        />
        {isLocked && (
          <View style={[StyleSheet.absoluteFill, styles.overlay]}>
            <Ionicons name="lock-closed" size={24} color="#fff" />
            {item.price_zar && (
                <Text style={styles.priceTxt}>R{item.price_zar}</Text>
            )}
          </View>
        )}
        {unlockingId === item.id && (
           <View style={[StyleSheet.absoluteFill, styles.overlayLoader]}>
               <ActivityIndicator color="#fff" />
           </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{pageTitle}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          data={assets}
          numColumns={COLUMN_COUNT}
          keyExtractor={a => a.id}
          contentContainerStyle={styles.grid}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textSecondary }]}>This creator hasn't posted any media yet.</Text>
          }
        />
      )}

      {selectedAsset && selectedAsset.full_url && (
        <Modal transparent visible animationType="fade">
          <View style={styles.modalBg}>
            <TouchableOpacity style={styles.closeModal} onPress={() => setSelectedAsset(null)}>
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>
            <Image 
              source={{ uri: selectedAsset.full_url }} 
              style={styles.fullImage} 
              resizeMode="contain" 
            />
            {selectedAsset.title && (
              <Text style={styles.assetTitleText}>{selectedAsset.title}</Text>
            )}
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { padding: SPACING },
  item: { width: ITEM_SIZE, height: ITEM_SIZE, margin: SPACING, overflow: 'hidden', borderRadius: 4 },
  image: { width: '100%', height: '100%' },
  overlay: { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  overlayLoader: { backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  priceTxt: { color: '#fff', fontWeight: '800', fontSize: 13, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 16, padding: 20 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  closeModal: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 },
  fullImage: { width: width, height: width * 1.5 },
  assetTitleText: { position: 'absolute', bottom: 40, color: '#fff', fontSize: 18, fontWeight: '700' }
});

export default MediaLibraryScreen;
