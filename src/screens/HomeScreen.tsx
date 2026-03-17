import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Modal,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useAppData } from '../store/AppDataContext';
import { useMessaging } from '../store/MessagingContext';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { Photographer, Model } from '../types';
import { AppLogo } from '../components/AppLogo';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { fetchRecommendedMatches } from '../services/matchService';

type Navigation = BottomTabNavigationProp<TabParamList, 'Home'>;
const MAX_HOME_CARDS = 120;
const randPerTier = 600;

const toHourlyRateRand = (price_range: string) => {
  const tiers = ((price_range || '').match(/\$/g) || []).length || 2;
  const amount = tiers * randPerTier + 600;
  return `R${amount.toLocaleString('en-ZA')}/hr`;
};

const HomeScreen: React.FC = () => {
  const { state, loading, error, refresh } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const parentNavigation = navigation.getParent<StackNavigationProp<RootStackParamList>>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState('All Categories');
  const [priceRange, setPriceRange] = useState('Any budget');
  const [sort, setSort] = useState('Highest Rated');
  const [location, setLocation] = useState('');
  const [discoveryMode, setDiscoveryMode] = useState<'photographers' | 'models'>('photographers');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  
  const [recommended, setRecommended] = useState<Photographer[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  React.useEffect(() => {
     // Initial generic recommendations
     fetchRecommendedMatches('Cape Town', '', 0).then(setRecommended);
  }, []);

  const handleSmartSearch = async () => {
      setIsSearching(true);
      try {
          // In a real app we'd parse budget from string, but here we just pass simple params
          const budget = priceRange.includes('$$') ? 1000 : 2000;
          const matches = await fetchRecommendedMatches(location, category === 'All Categories' ? '' : category, budget);
          setRecommended(matches);
      } catch (e) {
          console.warn(e);
      } finally {
          setIsSearching(false);
      }
  };

  const columns = width > 900 ? 3 : width > 700 ? 2 : 1;
  const isWideHero = width > 820;
  const role = state.currentUser?.role ?? 'client';
  const showGetStarted = !loading && !!state.currentUser && state.bookings.length === 0;

  const filteredTalent = useMemo(() => {
    let list = discoveryMode === 'photographers' ? [...state.photographers] : [...state.models];

    if (category !== 'All Categories') {
      list = list.filter((item) => item.tags.some((tag) => category.toLowerCase().includes(tag.toLowerCase())));
    }

    if (priceRange !== 'Any budget') {
      list = list.filter((item) => item.price_range.includes(priceRange.replace(/[^$]/g, '')));
    }

    if (location.trim().length > 0) {
      const query = location.toLowerCase();
      list = list.filter((item) => item.location.toLowerCase().includes(query));
    }

    if (sort === 'Highest Rated') {
      list = list.sort((a, b) => b.rating - a.rating);
    } else if (sort === 'Most Recent') {
      list = list.sort((a, b) => {
        const da = new Date(a.created_at || 0).valueOf();
        const db = new Date(b.created_at || 0).valueOf();
        return db - da;
      });
    }

    return list;
  }, [state.photographers, state.models, category, priceRange, sort, location, discoveryMode]);

  const visibleTalent = useMemo(() => filteredTalent.slice(0, MAX_HOME_CARDS), [filteredTalent]);
  const featuredPhotographer = discoveryMode === 'photographers' ? visibleTalent[0] ?? state.photographers[0] ?? null : null;
  const models = state.models ?? [];

  const startModelBooking = (model: Model) => {
    // Placeholder navigation — routes to BookingForm with photographer field re-used
    // until a dedicated model booking screen is built
    parentNavigation?.navigate('BookingForm', { photographerId: model.id });
  };

  const openProfile = (photographer: Photographer) => {
    parentNavigation?.navigate('Profile', { userId: photographer.id });
  };

  const startBooking = (photographer: Photographer) => {
    parentNavigation?.navigate('BookingForm', { photographerId: photographer.id });
  };

  const handleMessage = async (item: any) => {
    try {
      const convo = await startConversationWithUser(item.id, item.name);
      parentNavigation?.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (e) {
      console.warn('Failed to start chat:', e);
    }
  };

  const renderCard = (item: any) => (
    <View
      key={item.id}
      style={[
        styles.card,
        {
          width: columns === 1 ? '100%' : `${100 / columns - 3}%`,
          marginRight: columns === 1 ? 0 : 12,
          marginBottom: 14,
          backgroundColor: colors.card,
          borderColor: colors.border
        },
      ]}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }} style={styles.avatar} />
        <View style={[styles.ratingBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : '#111827cc' }]}>
          <Ionicons name="star" size={14} color="#fbbf24" />
          <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
        </View>
        <View style={styles.availabilityBadge}>
          <Text style={styles.availabilityText}>{discoveryMode === 'models' ? 'Ready to Shoot' : 'Available Today'}</Text>
        </View>
      </View>
      <View style={styles.cardContent}>
        <Text style={[styles.name, { color: colors.text }]}>{discoveryMode === 'models' ? item.name : item.name}</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>{item.location}</Text>
        <View style={styles.tagRowCompact}>
          {item.tags.slice(0, 3).map((tag: string) => (
            <View style={[styles.tag, { backgroundColor: colors.bg }]} key={tag}>
              <Text style={[styles.tagText, { color: colors.text }]}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.price, { color: colors.text }]}>{toHourlyRateRand(item.price_range)}</Text>
          <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
          <Text style={[styles.duration, { color: colors.textMuted }]}>{discoveryMode === 'models' ? 'Min 2 hours' : '~1 hour'}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.buttonSmall, { borderColor: colors.border, backgroundColor: colors.card }]} 
            onPress={() => handleMessage(item)}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.buttonGhost, { borderColor: colors.border }, discoveryMode === 'models' && styles.buttonVideo]} 
            onPress={() => discoveryMode === 'models'
              ? parentNavigation?.navigate('PaidVideoCall', { creatorId: item.id, role: 'viewer' })
              : openProfile(item)}
          >
            {discoveryMode === 'models' && <Ionicons name="videocam" size={16} color="#fff" style={{ marginRight: 6 }} />}
            <Text style={[styles.buttonGhostText, { color: colors.text }, discoveryMode === 'models' && styles.buttonVideoText]}>
              {discoveryMode === 'models' ? 'Video' : 'Profile'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.buttonPrimary, { backgroundColor: colors.accent }]} onPress={() => (discoveryMode === 'models' ? startModelBooking(item) : startBooking(item))}>
            <Text style={[styles.buttonPrimaryText, { color: colors.card }]}>Book</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(120, insets.bottom + 96) }]}
    >
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 24) }]}>
        <View style={styles.brandRow}>
          <AppLogo size={48} />
          <Text style={[styles.brandName, { color: colors.text }]}>Papzi</Text>
        </View>
        <View style={styles.navActions}>
          <View style={[styles.modeToggle, { backgroundColor: colors.bg }]}>
            <TouchableOpacity 
              style={[styles.modeBtn, discoveryMode === 'photographers' && [styles.modeBtnActive, { backgroundColor: colors.card }]]} 
              onPress={() => setDiscoveryMode('photographers')}
            >
              <Text style={[styles.modeBtnText, { color: colors.textMuted }, discoveryMode === 'photographers' && [styles.modeBtnTextActive, { color: colors.text }]]}>Photographers</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modeBtn, discoveryMode === 'models' && [styles.modeBtnActive, { backgroundColor: colors.card }]]} 
              onPress={() => setDiscoveryMode('models')}
            >
              <Text style={[styles.modeBtnText, { color: colors.textMuted }, discoveryMode === 'models' && [styles.modeBtnTextActive, { color: colors.text }]]}>Models</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity 
            style={[styles.linkPill, styles.navActionSpacer, { backgroundColor: colors.card }]}
            onPress={() => parentNavigation?.navigate('Notifications')}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsRail}>
        {[
          { icon: 'map-outline', label: 'Live Map', onPress: () => navigation.navigate('Map') },
          { icon: 'calendar-outline', label: 'Bookings', onPress: () => navigation.navigate('Bookings') },
          { icon: 'chatbubble-ellipses-outline', label: 'Messages', onPress: () => navigation.navigate('Chat') },
          { icon: 'help-buoy-outline', label: 'Support', onPress: () => parentNavigation?.navigate('Support') },
        ].map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.quickActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={item.onPress}
            activeOpacity={0.85}
          >
            <Ionicons name={item.icon as any} size={16} color={colors.accent} />
            <Text style={[styles.quickActionText, { color: colors.text }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <LinearGradient colors={isDark ? ['#1e293b', '#0f172a', '#020617'] : ['#e8edff', '#e0e7ff', '#cfd9f9']} style={[styles.hero, !isWideHero && styles.heroStacked, { borderColor: colors.border }]}>
        <View style={[styles.heroText, !isWideHero && styles.heroTextCentered]}>
          <Text style={[styles.title, !isWideHero && styles.titleCentered, { color: colors.text }]}>Find the Perfect Photographer for Your Moments</Text>
          <Text style={[styles.subtitle, !isWideHero && styles.subtitleCentered, { color: colors.textSecondary }]}>
            Connect with professional photographers in your area. Browse, compare, and book in minutes.
          </Text>
          <BlurView intensity={70} tint={isDark ? 'dark' : 'light'} style={[styles.searchCard, !isWideHero && styles.searchCardFull, { backgroundColor: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(255, 255, 255, 0.45)', borderColor: colors.border }]}>
            <View style={[styles.searchRow, !isWideHero && styles.searchRowStacked]}>
              <View style={[styles.inputGroup, styles.inputSpacer, !isWideHero && styles.inputGroupBlock, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Ionicons name="location-outline" size={18} color={colors.text} />
                <View style={styles.inputContent}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Location</Text>
                  <TextInput
                    placeholder="Enter your location"
                    value={location}
                    onChangeText={setLocation}
                    style={[styles.input, { color: colors.text }]}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, styles.dropdown, !isWideHero && styles.inputGroupBlock, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Ionicons name="camera-outline" size={18} color={colors.text} />
                <View style={styles.inputContent}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Category</Text>
                  <View style={styles.dropdownRow}>
                    <Text style={[styles.dropdownValue, { color: colors.text }]}>{category}</Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </View>
                </View>
              </View>
            </View>
            <Pressable 
              style={({ pressed }) => [styles.ctaButton, { backgroundColor: colors.accent }, pressed && styles.ctaButtonPressed]}
              onPress={handleSmartSearch}
            >
              <Ionicons name="search" size={18} color={isDark ? colors.bg : colors.card} />
              <Text style={[styles.ctaText, { color: isDark ? colors.bg : colors.card }]}>
                {isSearching ? 'Matching...' : 'Find Photographers'}
              </Text>
            </Pressable>
          </BlurView>
          <View style={[styles.metricsRow, !isWideHero && styles.metricsRowStacked]}>
            <View style={[styles.metric, styles.metricPrimary, { backgroundColor: isDark ? '#1e293b' : '#eef2ff', borderColor: isDark ? '#334155' : '#c7d2fe' }]}>
              <Text style={[styles.metricValue, { color: colors.text }]}>500+</Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Photographers</Text>
            </View>
            <View style={[styles.metric, styles.metricSecondary, { backgroundColor: isDark ? '#0f172a' : '#e0f2fe', borderColor: isDark ? '#1e293b' : '#bae6fd' }]}>
              <Text style={[styles.metricValue, { color: colors.text }]}>10k+</Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Happy Customers</Text>
            </View>
            <View style={[styles.metric, styles.metricTertiary, { backgroundColor: isDark ? '#064e3b' : '#ecfccb', borderColor: isDark ? '#065f46' : '#bef264' }]}>
              <Text style={[styles.metricValue, { color: colors.text }]}>4.9</Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Average Rating</Text>
            </View>
          </View>
        </View>
        <View style={[styles.heroCard, !isWideHero && styles.heroCardWide, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {featuredPhotographer ? (
            <>
              <Image source={{ uri: featuredPhotographer.avatar_url }} style={styles.heroCardImage} />
              <View style={[styles.heroCardOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(15, 23, 42, 0.72)' }]}>
                <Text style={styles.heroCardName}>{featuredPhotographer.name}</Text>
                <Text style={[styles.heroCardMeta, { color: isDark ? '#94a3b8' : '#cbd5e1' }]}>{featuredPhotographer.location}</Text>
                <View style={styles.heroCardRatingRow}>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={styles.heroCardRatingText}>{featuredPhotographer.rating.toFixed(1)} rating</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <Ionicons name="camera-outline" size={44} color={colors.text} />
              <Text style={[styles.heroCardTitle, { color: colors.text }]}>Top photographers updated daily</Text>
            </>
          )}
        </View>
      </LinearGradient>

      <View style={[styles.filtersCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text, fontSize: 18 }]}>Quick Filters</Text>
            <TouchableOpacity onPress={() => setFilterModalVisible(true)}>
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Advanced</Text>
            </TouchableOpacity>
        </View>
        <View style={styles.filtersRow}>
          {['All Categories', 'Wedding', 'Portrait', 'Event', 'Family'].map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.filterPill, { backgroundColor: colors.bg }, category === item && [styles.filterPillActive, { backgroundColor: colors.accent }]]}
              onPress={() => setCategory(item)}
            >
              <Text style={[styles.filterText, { color: colors.text }, category === item && [styles.filterTextActive, { color: colors.card }]]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filtersGrid}>
          <TouchableOpacity
            style={[styles.filterBox, styles.filterBoxSpacer, { backgroundColor: colors.bg, borderColor: colors.border }]}
            onPress={() => setPriceRange(priceRange === 'Any budget' ? '$$' : 'Any budget')}
          >
            <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Price Range</Text>
            <Text style={[styles.filterValue, { color: colors.text }]}>{priceRange === 'Any budget' ? 'R1,200+' : 'R1,800+'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterBox, { backgroundColor: colors.bg, borderColor: colors.border }]} onPress={() => setSort(sort === 'Highest Rated' ? 'Most Recent' : 'Highest Rated')}>
            <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Sort By</Text>
            <Text style={[styles.filterValue, { color: colors.text }]}>{sort}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showGetStarted && (
        <View style={[styles.getStartedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.getStartedHeader}>
            <Ionicons name="sparkles" size={18} color={colors.accent} />
            <Text style={[styles.getStartedTitle, { color: colors.text }]}>Get started</Text>
          </View>
          <Text style={[styles.getStartedBody, { color: colors.textSecondary }]}>
            {role === 'client'
              ? 'Find a creator and book your first session in minutes.'
              : 'Set up your profile and start accepting bookings.'}
          </Text>
          <View style={styles.getStartedActions}>
            {role === 'client' ? (
              <>
                <TouchableOpacity
                  style={[styles.buttonPrimary, { backgroundColor: colors.accent }]}
                  onPress={() => navigation.navigate('Feed')}
                >
                  <Text style={[styles.buttonPrimaryText, { color: colors.card }]}>Browse creators</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.buttonGhost, { borderColor: colors.border }]}
                  onPress={() => navigation.navigate('Settings')}
                >
                  <Text style={[styles.buttonGhostText, { color: colors.text }]}>Complete profile</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.buttonPrimary, { backgroundColor: colors.accent }]}
                  onPress={() => parentNavigation?.navigate('CreatePost')}
                >
                  <Text style={[styles.buttonPrimaryText, { color: colors.card }]}>Post your work</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.buttonGhost, { borderColor: colors.border }]}
                  onPress={() => navigation.navigate('Settings')}
                >
                  <Text style={[styles.buttonGhostText, { color: colors.text }]}>Update profile</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {discoveryMode === 'photographers' ? 'Available Photographers' : 'Featured Models'}
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
            {filteredTalent.length} options in your area
            {filteredTalent.length > MAX_HOME_CARDS ? ` (showing top ${MAX_HOME_CARDS})` : ''}
          </Text>
        </View>
        <TouchableOpacity style={[styles.lightButton, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="person-outline" size={16} color={colors.text} />
          <Text style={[styles.lightButtonText, { color: colors.text }]}>Account</Text>
        </TouchableOpacity>
      </View>

      {recommended.length > 0 && discoveryMode === 'photographers' && (
         <View style={styles.recommendedSection}>
            <View style={styles.recommendedHeader}>
                <Ionicons name="sparkles" size={20} color={colors.accent} />
                <Text style={[styles.recommendedTitle, { color: colors.text }]}>Recommended for you</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recommendedScroll}>
                {recommended.map((item, index) => (
                    <View key={`rec-${item.id}-${index}`} style={{ width: width * 0.7, maxWidth: 320 }}>
                        {renderCard(item)}
                    </View>
                ))}
            </ScrollView>
         </View>
      )}

      <View style={[styles.grid, { paddingHorizontal: columns > 1 ? 0 : 0 }]}>
        <FlatList
          data={visibleTalent}
          keyExtractor={(item, index) => (item.id ? `${item.id}-${index}` : `talent-${index}`)}
          numColumns={columns}
          key={columns} // force re-render on column count change
          renderItem={({ item }) => renderCard(item)}
          scrollEnabled={false} // outer ScrollView handles scroll
          columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        />
      </View>

      {visibleTalent.length === 0 && (
        <Text style={styles.empty}>No {discoveryMode} found in this area.</Text>
      )}

      {/* Advanced Filters Modal */}
      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { backgroundColor: colors.bg }]}>
             <View style={styles.modalHeader}>
                 <Text style={[styles.modalTitle, { color: colors.text }]}>Advanced Search</Text>
                 <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.iconBtn}>
                     <Ionicons name="close" size={24} color={colors.text} />
                 </TouchableOpacity>
             </View>

             <ScrollView style={styles.modalScroll}>
                <Text style={[styles.filterLabel, { color: colors.text }]}>Budget (ZAR)</Text>
                <View style={styles.filtersGrid}>
                    {['Any budget', '$$', '$$$'].map(item => (
                        <TouchableOpacity
                            key={`modal-price-${item}`}
                            style={[styles.filterBox, { backgroundColor: priceRange === item ? colors.accent : colors.card, borderColor: colors.border }]}
                            onPress={() => setPriceRange(item)}
                        >
                            <Text style={[{ color: priceRange === item ? '#fff' : colors.text, textAlign: 'center', fontWeight: '600' }]}>{item}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={[styles.filterLabel, { color: colors.text, marginTop: 24 }]}>Location / City</Text>
                <TextInput
                    style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    placeholder="e.g. Cape Town"
                    placeholderTextColor={colors.textMuted}
                    value={location}
                    onChangeText={setLocation}
                />

                <Text style={[styles.filterLabel, { color: colors.text, marginTop: 24 }]}>Category Specialty</Text>
                <View style={styles.filtersRow}>
                    {['All Categories', 'Wedding', 'Portrait', 'Fashion', 'Product', 'Real Estate'].map(item => (
                        <TouchableOpacity
                            key={`modal-cat-${item}`}
                            style={[
                                styles.filterPill, 
                                { backgroundColor: category === item ? colors.accent : colors.card, borderWidth: 1, borderColor: colors.border }
                            ]}
                            onPress={() => setCategory(item)}
                        >
                            <Text style={[{ color: category === item ? '#fff' : colors.text, fontWeight: '600' }]}>{item}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
             </ScrollView>

             <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
                 <TouchableOpacity 
                    style={[styles.buttonPrimary, { backgroundColor: colors.accent, width: '100%' }]} 
                    onPress={() => { setFilterModalVisible(false); handleSmartSearch(); }}
                 >
                     <Text style={[styles.buttonPrimaryText, { color: colors.card, textAlign: 'center' }]}>Apply Filters</Text>
                 </TouchableOpacity>
             </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  quickActionsRail: {
    paddingBottom: 12,
    gap: 10,
  },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    padding: 4,
    borderRadius: 14,
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  modeBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  modeBtnTextActive: {
    color: '#0f172a',
  },
  navActions: {
    flexDirection: 'row',
    marginLeft: 10,
  },
  navActionSpacer: {
    marginLeft: 8,
  },
  linkPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  linkText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  linkFilled: {
    backgroundColor: '#0f172a',
  },
  linkFilledText: {
    color: '#fff',
  },
  hero: {
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#a5b4fc',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  heroStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  heroText: {
    flex: 1,
    paddingRight: 16,
  },
  heroTextCentered: {
    alignItems: 'center',
    paddingRight: 0,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 36,
    marginTop: 6,
  },
  titleCentered: {
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
    marginTop: 6,
  },
  subtitleCentered: {
    textAlign: 'center',
  },
  searchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    marginTop: 14,
    overflow: 'hidden',
  },
  searchCardFull: {
    width: '100%',
    alignSelf: 'stretch',
  },
  searchRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  searchRowStacked: {
    flexDirection: 'column',
  },
  inputGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  inputSpacer: {
    marginRight: 10,
  },
  inputGroupBlock: {
    width: '100%',
    marginRight: 0,
    marginBottom: 12,
  },
  inputContent: {
    flex: 1,
    marginLeft: 10,
  },
  inputLabel: {
    color: '#1f2937',
    fontWeight: '700',
    marginBottom: 2,
    fontSize: 12,
  },
  input: {
    flex: 1,
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
  dropdown: {
    justifyContent: 'center',
    marginRight: 0,
  },
  dropdownValue: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 15,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaButton: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 8,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  ctaButtonPressed: {
    backgroundColor: '#0c1431',
  },
  metricsRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 4,
    justifyContent: 'space-between',
    marginHorizontal: -6,
  },
  metricsRowStacked: {
    flexDirection: 'column',
  },
  metric: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    alignItems: 'flex-start',
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    marginHorizontal: 6,
    marginBottom: 10,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  metricLabel: {
    color: '#475569',
    marginTop: 2,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  metricPrimary: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  metricSecondary: {
    backgroundColor: '#e0f2fe',
    borderColor: '#bae6fd',
  },
  metricTertiary: {
    backgroundColor: '#ecfccb',
    borderColor: '#bef264',
  },
  heroCard: {
    width: 230,
    minHeight: 220,
    backgroundColor: '#fff',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  heroCardImage: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
  },
  heroCardOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  heroCardName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  heroCardMeta: {
    color: '#cbd5e1',
    marginTop: 2,
  },
  heroCardRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  heroCardRatingText: {
    color: '#fff',
    marginLeft: 6,
    fontWeight: '700',
  },
  heroCardWide: {
    width: '100%',
    marginTop: 16,
  },
  heroCardTitle: {
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginTop: 10,
    fontSize: 17,
    lineHeight: 22,
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  getStartedCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  getStartedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  getStartedTitle: { fontWeight: '800', fontSize: 16 },
  getStartedBody: { fontSize: 13, marginBottom: 12 },
  getStartedActions: { flexDirection: 'row', gap: 10 },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 10,
    marginHorizontal: -4,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    margin: 4,
  },
  filterPillActive: {
    backgroundColor: '#0f172a',
  },
  filterText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  filterTextActive: {
    color: '#fff',
  },
  filtersGrid: {
    flexDirection: 'row',
    marginTop: 6,
  },
  filterBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  filterBoxSpacer: {
    marginRight: 10,
  },
  filterLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  filterValue: {
    color: '#0f172a',
    fontWeight: '700',
    marginTop: 4,
  },
  sectionHeader: {
    marginTop: 4,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionSubtitle: {
    color: '#475569',
    marginTop: 2,
  },
  lightButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  lightButtonText: {
    fontWeight: '700',
    color: '#0f172a',
    marginLeft: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  recommendedSection: {
    marginBottom: 20,
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
    paddingVertical: 16,
    borderRadius: 16,
  },
  recommendedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  recommendedTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  recommendedScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '75%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  iconBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  modalScroll: {
    paddingHorizontal: 20,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginTop: 8,
  },
  modalFooter: {
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  imageWrap: {
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: 220,
  },
  ratingBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    backgroundColor: '#111827cc',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 6,
  },
  availabilityBadge: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  availabilityText: {
    color: '#fff',
    fontWeight: '700',
  },
  cardContent: {
    padding: 12,
    paddingTop: 10,
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  meta: {
    color: '#475569',
  },
  tagRowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  tag: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 6,
  },
  tagText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  price: {
    fontWeight: '800',
    color: '#0f172a',
  },
  dot: {
    color: '#94a3b8',
  },
  duration: {
    color: '#475569',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '800',
  },
  buttonGhost: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonGhostText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 13,
  },
  buttonSmall: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonVideo: {
    backgroundColor: '#8b5cf6',
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonVideoText: {
    color: '#fff',
  },
  empty: {
    textAlign: 'center',
    marginTop: 16,
    color: '#475569',
  },
  // Models section
  modelsSection: { marginBottom: 24 },
  modelsScroll: { paddingVertical: 8, paddingRight: 16 },
  modelCard: {
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginRight: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    shadowColor: '#ec4899',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    position: 'relative',
  },
  modelAvatar: { width: '100%', height: 120, borderRadius: 12, marginBottom: 10 },
  modelBadge: {
    position: 'absolute', top: 22, left: 22, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#ec4899', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  modelBadgeTxt: { color: '#fff', fontWeight: '800', fontSize: 10 },
  modelRating: {
    position: 'absolute', top: 22, right: 22, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
  },
  modelRatingTxt: { color: '#fff', fontWeight: '700', fontSize: 11 },
  modelName: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 2 },
  modelStyle: { fontSize: 12, color: '#8b5cf6', fontWeight: '600', marginBottom: 2 },
  modelLocation: { fontSize: 11, color: '#64748b', marginBottom: 8 },
  modelTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  modelTag: { backgroundColor: '#fce7f3', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  modelTagTxt: { color: '#9d174d', fontWeight: '600', fontSize: 10 },
  modelBookBtn: { backgroundColor: '#0f172a', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  modelBookTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
});

export default HomeScreen;
