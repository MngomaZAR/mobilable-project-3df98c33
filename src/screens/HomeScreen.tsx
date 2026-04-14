import React, { useMemo, useState, useRef } from 'react';
import {
  Alert,
  Image,
  Keyboard,
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
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
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
import { BRAND, PLACEHOLDER_AVATAR } from '../utils/constants';
import { resolveUserRole } from '../utils/userRole';
import { isLiveVideoAvailable, LIVE_VIDEO_UNAVAILABLE_MESSAGE } from '../utils/videoCalls';

type Navigation = BottomTabNavigationProp<TabParamList, 'Home'>;
const MAX_HOME_CARDS = 120;
const randPerTier = 600;
const SHOWCASE_PRIORITY_NAMES = ['Olivia Harris', 'Michael Scott', 'Anna Gomez', 'Jason Lee'];

const toHourlyRateRand = (price_range: string) => {
  const tiers = ((price_range || '').match(/\$/g) || []).length || 2;
  const amount = tiers * randPerTier + 600;
  return `R${amount.toLocaleString('en-ZA')}/hr`;
};

const toSafeLower = (value: unknown) => String(value ?? '').toLowerCase();
const toSafeTags = (value: unknown): string[] => (Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []);
const toSafeRating = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const isOnlineStatus = (value: unknown) => ['online', 'available', 'active'].includes(toSafeLower(value));

const HomeScreen: React.FC = () => {
  const { state, loading, error, refresh } = useAppData();
  const { startConversationWithUser } = useMessaging();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<TabParamList, 'Home'>>();
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
  const lastSearchTagRef = useRef<string | null>(null);

  React.useEffect(() => {
     // Use logged-in user's city for initial recommendations
     const userCity = state.currentUser?.city ?? '';
     fetchRecommendedMatches(userCity, '', 0).then(setRecommended);
  }, [state.currentUser?.city]);

  React.useEffect(() => {
    const rawTag = route.params?.searchTag?.trim();
    if (!rawTag) return;
    if (lastSearchTagRef.current === rawTag) return;
    lastSearchTagRef.current = rawTag;
    const nextLocation = location.trim() || state.currentUser?.city || '';
    const budget = priceRange.includes('$$') ? 1000 : 2000;
    setDiscoveryMode('photographers');
    setCategory(rawTag);
    if (!location.trim()) setLocation(nextLocation);
    setIsSearching(true);
    fetchRecommendedMatches(nextLocation, rawTag, budget)
      .then(setRecommended)
      .finally(() => setIsSearching(false));
  }, [route.params?.searchTag, location, priceRange, state.currentUser?.city]);

  const handleSmartSearch = async () => {
      Keyboard.dismiss();
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
  const role = resolveUserRole(state.currentUser);
  const liveVideoAvailable = isLiveVideoAvailable();
  const useReferenceClientLayout = role === 'client';
  const showGetStarted = !loading && !!state.currentUser && state.bookings.length === 0;
  const showEntryCard = role !== 'client';
  const accentButtonTextColor = '#1f1a12';

  const handleVideoAction = React.useCallback((item: Photographer | Model) => {
    if (!liveVideoAvailable) {
      Alert.alert('Unavailable', LIVE_VIDEO_UNAVAILABLE_MESSAGE);
      return;
    }
    parentNavigation?.navigate('PaidVideoCall', { creatorId: item.id, role: 'viewer' });
  }, [liveVideoAvailable, parentNavigation]);

  const profileById = useMemo(() => {
    const map = new Map<string, any>();
    (state.profiles ?? []).forEach((p: any) => {
      if (p?.id) map.set(p.id, p);
    });
    return map;
  }, [state.profiles]);

  const hasProfileData = profileById.size > 0;
  const isTalentEligible = (item: any) => {
    if (!hasProfileData) return true;
    const profile = profileById.get(item.id);
    const kycApproved = profile?.kyc_status === 'approved' || profile?.verified === true;
    const ageVerified = Boolean(profile?.age_verified);
    const hasTier = String(item?.tier_id ?? item?.price_range ?? '').trim().length > 0;
    const hasEquipment = Array.isArray(item?.equipment?.camera)
      ? item.equipment.camera.length > 0
      : Array.isArray(item?.tags) && item.tags.length > 0;
    return kycApproved && ageVerified && hasTier && hasEquipment;
  };

  const filteredTalent = useMemo(() => {
    let list = discoveryMode === 'photographers' ? [...state.photographers] : [...state.models];
    list = list.filter(isTalentEligible);

    if (category !== 'All Categories') {
      const categoryLower = toSafeLower(category);
      list = list.filter((item: any) =>
        toSafeTags(item?.tags).some((tag) => categoryLower.includes(toSafeLower(tag)))
      );
    }

    if (priceRange !== 'Any budget') {
      const priceFilter = priceRange.replace(/[^$]/g, '');
      list = list.filter((item: any) => String(item?.price_range ?? '').includes(priceFilter));
    }

    if (location.trim().length > 0) {
      const query = toSafeLower(location);
      list = list.filter((item: any) => toSafeLower(item?.location).includes(query));
    }

    if (sort === 'Highest Rated') {
      list = list.sort((a: any, b: any) => toSafeRating(b?.rating) - toSafeRating(a?.rating));
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
  const onlineNearbyCount = useMemo(
    () => (state.profiles ?? []).filter((p: any) => isOnlineStatus(p?.availability_status)).length,
    [state.profiles]
  );
  const showcaseItems = useMemo(() => {
    const byName = new Map((state.photographers ?? []).map((p) => [p.name, p]));
    const priorityItems = SHOWCASE_PRIORITY_NAMES
      .map((name) => {
        const item = byName.get(name);
        if (!item) return null;
        return {
          ...item,
          showcaseCategory:
            item.specialties?.[0] ??
            item.tags?.[0] ??
            item.style ??
            'Photography',
        };
      })
      .filter(Boolean) as Array<any>;

    if (priorityItems.length > 0) return priorityItems;

    return [...(state.photographers ?? [])]
      .sort((a, b) => toSafeRating(b.rating) - toSafeRating(a.rating))
      .slice(0, 4)
      .map((item) => ({
        ...item,
        showcaseCategory:
          item.specialties?.[0] ??
          item.tags?.[0] ??
          item.style ??
          'Photography',
      }));
  }, [state.photographers]);

  const recommendedPhotographers = useMemo(() => {
    const list = (recommended?.length ? recommended : filteredTalent).filter((item: any) => item?.avatar_url);
    return list.slice(0, 8);
  }, [recommended, filteredTalent]);

  const startModelBooking = (model: Model) => {
    parentNavigation?.navigate('BookingForm', { modelId: model.id, serviceType: 'modeling' });
  };

  const openProfile = (photographer: Photographer) => {
    parentNavigation?.navigate('Profile', { userId: photographer.id });
  };

  const startBooking = (photographer: Photographer) => {
    parentNavigation?.navigate('BookingForm', { photographerId: photographer.id, serviceType: 'photography' });
  };

  const hasBookingWithTalent = (talentId: string) => {
    const userId = state.currentUser?.id;
    if (!userId) return false;
    return state.bookings.some((booking) => {
      const isTalentMatch = booking.photographer_id === talentId || booking.model_id === talentId;
      const isClientMatch = booking.client_id === userId;
      return isTalentMatch && isClientMatch;
    });
  };

  const ensureBookingFirst = (talent: any) => {
    if (hasBookingWithTalent(talent.id)) return true;
    Alert.alert(
      'Booking required',
      'To keep things safe, start a booking before messaging.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Book now', onPress: () => (discoveryMode === 'models' ? startModelBooking(talent) : startBooking(talent)) },
      ]
    );
    return false;
  };

  const handleMessage = async (item: any) => {
    if (!ensureBookingFirst(item)) return;
    try {
      const convo = await startConversationWithUser(item.id, item.name);
      parentNavigation?.navigate('ChatThread', { conversationId: convo.id, title: convo.title });
    } catch (e) {
      console.warn('Failed to start chat:', e);
    }
  };

  const handlePrimaryCTA = (mode: 'photographers' | 'models') => {
    setDiscoveryMode(mode);
    if (!location.trim()) {
      setLocation(state.currentUser?.city ?? '');
    }
    handleSmartSearch();
  };

  const renderCard = (item: any) => {
    const profile = profileById.get(item.id);
    const isOnline = isOnlineStatus(profile?.availability_status);
    const rate = Number(item?.hourly_rate ?? 0);
    const priceLabel = rate > 0 ? `R${rate.toLocaleString('en-ZA')}/hr` : toHourlyRateRand(String(item?.price_range ?? '$$'));
    const requestButtonBackground = isOnline ? colors.accent : (isDark ? '#0f172a' : '#1f2937');
    const requestButtonTextColor = isOnline ? accentButtonTextColor : '#fffaf2';
    const canOpenVideo = discoveryMode === 'models' && role === 'client' && liveVideoAvailable;

    return (
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
          <Image source={{ uri: item.avatar_url || PLACEHOLDER_AVATAR }} style={styles.avatar} />
          <View style={[styles.ratingBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : '#111827cc' }]}>
            <Ionicons name="star" size={14} color="#fbbf24" />
            <Text style={styles.ratingText}>{toSafeRating(item?.rating).toFixed(1)}</Text>
          </View>
          {isOnline && (
            <View style={styles.availabilityBadge}>
              <Text style={styles.availabilityText}>{discoveryMode === 'models' ? 'Ready to Shoot' : 'Available Today'}</Text>
            </View>
          )}
        </View>
      <View style={styles.cardContent}>
        <Text style={[styles.name, { color: colors.text }]}>{String(item?.name ?? 'Creator')}</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>{String(item?.location ?? 'South Africa')}</Text>
        <View style={styles.tagRowCompact}>
          {toSafeTags(item?.tags).slice(0, 3).map((tag: string) => (
            <View style={[styles.tag, { backgroundColor: colors.bg }]} key={tag}>
              <Text style={[styles.tagText, { color: colors.text }]}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.price, { color: colors.text }]}>{priceLabel}</Text>
          <Text style={[styles.dot, { color: colors.textMuted }]}>|</Text>
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
            style={[
              styles.buttonGhost,
              { borderColor: colors.border },
              canOpenVideo && styles.buttonVideo
            ]} 
            onPress={() => canOpenVideo
              ? handleVideoAction(item)
              : openProfile(item)}
          >
            {canOpenVideo && <Ionicons name="videocam" size={16} color="#fff" style={{ marginRight: 6 }} />}
            <Text style={[styles.buttonGhostText, { color: colors.text }, canOpenVideo && styles.buttonVideoText]}>
              {canOpenVideo ? 'Video' : 'Profile'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.buttonPrimary, { backgroundColor: requestButtonBackground }, !isOnline && { opacity: 0.82 }]}
            onPress={() => (discoveryMode === 'models' ? startModelBooking(item) : startBooking(item))}
            disabled={!isOnline}
          >
            <Text style={[styles.buttonPrimaryText, { color: requestButtonTextColor }]}>{isOnline ? 'Request' : 'Offline'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(120, insets.bottom + 96) }]}
      keyboardShouldPersistTaps="handled"
    >
      {!useReferenceClientLayout ? (
        <View
          style={[
            styles.topBar,
            {
              paddingTop: Math.max(insets.top + 8, 30),
              backgroundColor: isDark ? 'rgba(17, 26, 45, 0.68)' : '#fff8ef',
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.brandRow}>
            <AppLogo size={48} />
            <Text style={[styles.brandName, { color: colors.text }]}>{BRAND.name}</Text>
          </View>
          <View style={styles.navActions}>
            <TouchableOpacity 
              style={[styles.linkPill, { backgroundColor: colors.card }]}
              onPress={() => parentNavigation?.navigate('Notifications')}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ height: Math.max(insets.top, 10) }} />
      )}

      <View style={[styles.logoShowcase, { backgroundColor: isDark ? 'rgba(16, 24, 39, 0.68)' : 'rgba(255, 248, 239, 0.96)', borderColor: colors.border }]}>
        <View style={[styles.logoHalo, { backgroundColor: isDark ? 'rgba(217, 166, 74, 0.16)' : 'rgba(216, 172, 92, 0.14)' }]} />
        <View style={[styles.logoBadge, { backgroundColor: isDark ? '#131c30' : '#fffaf3', borderColor: isDark ? '#3a4866' : '#ead7b6' }]}>
          <AppLogo size={92} />
        </View>
      </View>

      <View style={[styles.livePill, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.liveDot} />
        <Text style={[styles.livePillText, { color: colors.text }]}>Live • {onlineNearbyCount} online nearby</Text>
      </View>

      <View style={[styles.discoverySwitch, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.discoverySwitchBtn,
            discoveryMode === 'photographers' && { backgroundColor: colors.accent },
          ]}
          onPress={() => setDiscoveryMode('photographers')}
        >
          <Ionicons name="camera" size={14} color={discoveryMode === 'photographers' ? accentButtonTextColor : colors.text} />
          <Text
            style={[
              styles.discoverySwitchText,
              { color: discoveryMode === 'photographers' ? accentButtonTextColor : colors.text },
            ]}
          >
            Photographers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.discoverySwitchBtn,
            discoveryMode === 'models' && { backgroundColor: colors.accent },
          ]}
          onPress={() => setDiscoveryMode('models')}
        >
          <Ionicons name="sparkles" size={14} color={discoveryMode === 'models' ? accentButtonTextColor : colors.text} />
          <Text
            style={[
              styles.discoverySwitchText,
              { color: discoveryMode === 'models' ? accentButtonTextColor : colors.text },
            ]}
          >
            Models
          </Text>
        </TouchableOpacity>
      </View>

      {showEntryCard && (
        <View style={[styles.entryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.entryTitle, { color: colors.text }]}>What do you want to book?</Text>
          <Text style={[styles.entrySubtitle, { color: colors.textSecondary }]}>Start with a single request. Everything else flows from there.</Text>
          <View style={styles.entryActions}>
            <TouchableOpacity
              style={[styles.entryPrimary, { backgroundColor: colors.accent }]}
              onPress={() => handlePrimaryCTA('photographers')}
            >
              <Ionicons name="camera-outline" size={18} color={accentButtonTextColor} />
              <Text style={[styles.entryPrimaryText, { color: accentButtonTextColor }]}>Book Photographer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.entrySecondary, { borderColor: colors.border }]}
              onPress={() => handlePrimaryCTA('models')}
            >
              <Ionicons name="sparkles-outline" size={18} color={colors.text} />
              <Text style={[styles.entrySecondaryText, { color: colors.text }]}>Book Model</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.entryGhost, { backgroundColor: colors.bg }]} onPress={() => navigation.navigate('Feed')}>
            <Text style={[styles.entryGhostText, { color: colors.text }]}>Explore</Text>
          </TouchableOpacity>
        </View>
      )}

      {showEntryCard && (
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
      )}

      <LinearGradient colors={isDark ? ['#121a2b', '#0a1222', '#060b14'] : ['#f7f1e7', '#f1e8da', '#eadfca']} style={[styles.hero, !isWideHero && styles.heroStacked, useReferenceClientLayout && styles.heroReference, { borderColor: colors.border }]}>
        <View style={[styles.heroText, !isWideHero && styles.heroTextCentered, useReferenceClientLayout && styles.heroTextCompact]}>
          {!useReferenceClientLayout ? (
            <>
              <Text style={[styles.title, !isWideHero && styles.titleCentered, { color: colors.text }]}>
                {discoveryMode === 'photographers' ? 'Find photographers near you' : 'Find models near you'}
              </Text>
              <Text style={[styles.subtitle, !isWideHero && styles.subtitleCentered, { color: colors.textSecondary }]}>
                Browse profiles, compare ratings, and book in minutes.
              </Text>
            </>
          ) : null}
          <BlurView intensity={70} tint={isDark ? 'dark' : 'light'} style={[styles.searchCard, !isWideHero && styles.searchCardFull, useReferenceClientLayout && styles.searchCardReference, { backgroundColor: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(255, 255, 255, 0.45)', borderColor: colors.border }]}>
            <View style={[styles.searchRow, !isWideHero && styles.searchRowStacked]}>
              <View style={[styles.inputGroup, styles.inputSpacer, !isWideHero && styles.inputGroupBlock, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Ionicons name="location-outline" size={18} color={colors.text} />
                <View style={styles.inputContent}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Location</Text>
                  <TextInput
                    placeholder="Durban"
                    value={location}
                    onChangeText={setLocation}
                    onSubmitEditing={handleSmartSearch}
                    returnKeyType="search"
                    blurOnSubmit
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
              <Ionicons name="search" size={18} color={accentButtonTextColor} />
              <Text style={[styles.ctaText, { color: accentButtonTextColor }]}>
                {isSearching ? 'Matching...' : discoveryMode === 'photographers' ? 'Find Photographers' : 'Find Models'}
              </Text>
            </Pressable>
          </BlurView>
          {!useReferenceClientLayout ? (
            <View style={[styles.metricsRow, !isWideHero && styles.metricsRowStacked]}>
              <View style={[styles.metric, styles.metricPrimary, { backgroundColor: isDark ? '#1f2d49' : '#efe5d6', borderColor: isDark ? '#334a71' : '#dcc8ab' }]}>
                <Text style={[styles.metricValue, { color: colors.text }]}>500+</Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Photographers</Text>
              </View>
              <View style={[styles.metric, styles.metricSecondary, { backgroundColor: isDark ? '#182338' : '#e9ddca', borderColor: isDark ? '#2a3a58' : '#d6c2a1' }]}>
                <Text style={[styles.metricValue, { color: colors.text }]}>10k+</Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Happy Customers</Text>
              </View>
              <View style={[styles.metric, styles.metricTertiary, { backgroundColor: isDark ? '#173428' : '#deefdf', borderColor: isDark ? '#1f4f3a' : '#b8d9bd' }]}>
                <Text style={[styles.metricValue, { color: colors.text }]}>4.9</Text>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Average Rating</Text>
              </View>
            </View>
          ) : null}
        </View>
        {!useReferenceClientLayout ? (
        <View style={[styles.heroCard, !isWideHero && styles.heroCardWide, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {featuredPhotographer ? (
            <>
              <Image source={{ uri: featuredPhotographer.avatar_url }} style={styles.heroCardImage} />
              <View style={[styles.heroCardOverlay, { backgroundColor: isDark ? 'rgba(6,10,18,0.84)' : 'rgba(74, 56, 30, 0.74)' }]}>
                <Text style={styles.heroCardName}>{featuredPhotographer.name}</Text>
                <Text style={[styles.heroCardMeta, { color: isDark ? '#94a3b8' : '#cbd5e1' }]}>{featuredPhotographer.location}</Text>
                <View style={styles.heroCardRatingRow}>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={styles.heroCardRatingText}>{toSafeRating(featuredPhotographer.rating).toFixed(1)} rating</Text>
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
        ) : null}
      </LinearGradient>

      {showcaseItems.length > 0 && (
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Explore Categories</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
            {showcaseItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.categoryCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => openProfile(item)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: item.avatar_url }} style={styles.categoryImage} />
                <View style={styles.categoryInfo}>
                  <Text style={[styles.categoryName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                  <View style={styles.categoryMetaRow}>
                    <Ionicons name="star" size={12} color="#fbbf24" />
                    <Text style={[styles.categoryMetaText, { color: colors.textSecondary }]}>
                      {toSafeRating(item.rating).toFixed(1)} · {Number(item.review_count ?? 0).toLocaleString('en-ZA')} reviews · {Number(item.total_bookings ?? 0).toLocaleString('en-ZA')} bookings
                    </Text>
                  </View>
                  <Text style={[styles.categoryLabel, { color: colors.textMuted }]}>{item.showcaseCategory}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {recommendedPhotographers.length > 0 && (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recommended Photographers</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Feed')}>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recommendedRail}>
            {recommendedPhotographers.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.recommendedCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => openProfile(item)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: item.avatar_url }} style={styles.recommendedImage} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
              <Text style={[styles.filterText, { color: colors.text }, category === item && [styles.filterTextActive, { color: accentButtonTextColor }]]}>{item}</Text>
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
                  <Text style={[styles.buttonPrimaryText, { color: accentButtonTextColor }]}>Browse creators</Text>
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
                  <Text style={[styles.buttonPrimaryText, { color: accentButtonTextColor }]}>Post your work</Text>
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
                            <Text style={[{ color: priceRange === item ? accentButtonTextColor : colors.text, textAlign: 'center', fontWeight: '600' }]}>{item}</Text>
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
                            <Text style={[{ color: category === item ? accentButtonTextColor : colors.text, fontWeight: '600' }]}>{item}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
             </ScrollView>

             <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
                 <TouchableOpacity 
                    style={[styles.buttonPrimary, { backgroundColor: colors.accent, width: '100%' }]} 
                    onPress={() => { setFilterModalVisible(false); handleSmartSearch(); }}
                 >
                     <Text style={[styles.buttonPrimaryText, { color: accentButtonTextColor, textAlign: 'center' }]}>Apply Filters</Text>
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
    backgroundColor: '#f4f1eb',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  quickActionsRail: {
    paddingBottom: 12,
    gap: 10,
  },
  livePill: {
    alignSelf: 'flex-start',
    marginHorizontal: 2,
    marginTop: -2,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  livePillText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  logoShowcase: {
    alignSelf: 'center',
    width: 168,
    height: 168,
    marginTop: 6,
    marginBottom: 12,
    borderRadius: 84,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#23170b',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  logoHalo: {
    position: 'absolute',
    width: 138,
    height: 138,
    borderRadius: 69,
  },
  logoBadge: {
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoverySwitch: {
    alignSelf: 'stretch',
    marginBottom: 16,
    borderRadius: 999,
    flexDirection: 'row',
    borderWidth: 1,
    overflow: 'hidden',
  },
  discoverySwitchBtn: {
    flex: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  discoverySwitchText: {
    fontWeight: '700',
    fontSize: 13,
  },
  entryCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#1f2937',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  entryTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  entrySubtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  entryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  entryPrimary: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
  entryPrimaryText: {
    fontWeight: '800',
    fontSize: 14,
  },
  entrySecondary: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  entrySecondaryText: {
    fontWeight: '800',
    fontSize: 14,
  },
  entryGhost: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  entryGhostText: {
    fontWeight: '700',
  },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  brandName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
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
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#dcccb0',
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
    borderRadius: 32,
    padding: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#1d160d',
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  heroReference: {
    padding: 0,
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
    borderWidth: 0,
    marginBottom: 18,
  },
  heroStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  heroText: {
    flex: 1,
    paddingRight: 16,
  },
  heroTextCompact: {
    paddingRight: 0,
  },
  heroTextCentered: {
    alignItems: 'center',
    paddingRight: 0,
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: '#0f172a',
    lineHeight: 42,
    marginTop: 2,
  },
  titleCentered: {
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    lineHeight: 24,
    marginTop: 8,
  },
  subtitleCentered: {
    textAlign: 'center',
  },
  searchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 28,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 9 },
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    marginTop: 16,
    overflow: 'hidden',
  },
  searchCardFull: {
    width: '100%',
    alignSelf: 'stretch',
  },
  searchCardReference: {
    marginTop: 0,
    borderRadius: 24,
    padding: 16,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
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
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
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
    borderRadius: 20,
    paddingVertical: 17,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#2f2010',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
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
    marginTop: 12,
    marginBottom: 2,
    justifyContent: 'space-between',
    marginHorizontal: -6,
  },
  metricsRowStacked: {
    flexDirection: 'column',
  },
  metric: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 20,
    alignItems: 'flex-start',
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
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
    width: 252,
    minHeight: 254,
    backgroundColor: '#fff',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  heroCardImage: {
    width: '100%',
    height: 254,
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
    borderRadius: 28,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#17110a',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    borderWidth: 1,
    borderColor: '#e2d3bc',
  },
  getStartedCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
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
    borderWidth: 1,
    borderColor: '#e0d2bc',
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
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
  sectionBlock: {
    marginBottom: 22,
  },
  categoryRail: {
    paddingRight: 12,
    gap: 14,
  },
  categoryCard: {
    width: 154,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#20170d',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  categoryImage: {
    width: '100%',
    height: 116,
  },
  categoryInfo: {
    padding: 10,
    gap: 4,
  },
  categoryName: {
    fontWeight: '800',
    fontSize: 14,
  },
  categoryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryMetaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  recommendedRail: {
    paddingRight: 12,
    gap: 12,
  },
  recommendedCard: {
    width: 146,
    height: 112,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#20170d',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  recommendedImage: {
    width: '100%',
    height: '100%',
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dfcfb5',
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
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#20170d',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  recommendedSection: {
    marginBottom: 20,
    backgroundColor: 'rgba(176, 137, 87, 0.08)',
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e3d2b8',
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
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
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
    backgroundColor: 'rgba(176, 137, 87, 0.14)',
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
    height: 238,
  },
  ratingBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ead7b6',
  },
  ratingText: {
    color: '#4b5563',
    fontWeight: '700',
    marginLeft: 6,
  },
  availabilityBadge: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: '#3f6f43',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  availabilityText: {
    color: '#fff',
    fontWeight: '700',
  },
  cardContent: {
    padding: 14,
    paddingTop: 12,
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
    marginTop: 10,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontWeight: '800',
  },
  buttonGhost: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 13,
    borderRadius: 16,
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
    borderRadius: 16,
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
