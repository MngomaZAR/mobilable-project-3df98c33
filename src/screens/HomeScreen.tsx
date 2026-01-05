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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { Photographer } from '../types';
import { AppLogo } from '../components/AppLogo';

type Navigation = StackNavigationProp<RootStackParamList, 'Root'>;

const HomeScreen: React.FC = () => {
  const { state, loading, error, refresh } = useAppData();
  const navigation = useNavigation<Navigation>();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState('All Categories');
  const [priceRange, setPriceRange] = useState('Any budget');
  const [sort, setSort] = useState('Highest Rated');
  const [location, setLocation] = useState('');

  const columns = width > 900 ? 3 : width > 700 ? 2 : 1;
  const isWideHero = width > 820;

  const filteredPhotographers = useMemo(() => {
    let list = [...state.photographers];

    if (category !== 'All Categories') {
      list = list.filter((item) => item.tags.some((tag) => category.toLowerCase().includes(tag.toLowerCase())));
    }

    if (priceRange !== 'Any budget') {
      list = list.filter((item) => item.priceRange.includes(priceRange.replace(/[^$]/g, '')));
    }

    if (location.trim().length > 0) {
      const query = location.toLowerCase();
      list = list.filter((item) => item.location.toLowerCase().includes(query));
    }

    if (sort === 'Highest Rated') {
      list = list.sort((a, b) => b.rating - a.rating);
    }

    return list;
  }, [state.photographers, category, priceRange, sort, location]);

  const openProfile = (photographer: Photographer) => {
    navigation.navigate('Profile', { photographerId: photographer.id });
  };

  const startBooking = (photographer: Photographer) => {
    navigation.navigate('BookingForm', { photographerId: photographer.id });
  };

  const renderCard = (item: Photographer) => (
    <View
      key={item.id}
      style={[
        styles.card,
        {
          width: columns === 1 ? '100%' : `${100 / columns - 3}%`,
          marginRight: columns === 1 ? 0 : 12,
          marginBottom: 14,
        },
      ]}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={styles.ratingBadge}>
          <Ionicons name="star" size={14} color="#fbbf24" />
          <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
        </View>
        <View style={styles.availabilityBadge}>
          <Text style={styles.availabilityText}>Available Today</Text>
        </View>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>{item.location}</Text>
        <View style={styles.tagRowCompact}>
          {item.tags.slice(0, 3).map((tag) => (
            <View style={styles.tag} key={tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.price}>${(item.priceRange.match(/\$/g) || []).length * 50 + 50}/hr</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.duration}>~1 hour</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.buttonGhost} onPress={() => openProfile(item)}>
            <Text style={styles.buttonGhostText}>View Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonPrimary} onPress={() => startBooking(item)}>
            <Text style={styles.buttonPrimaryText}>Book Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <AppLogo size={48} />
          <Text style={styles.brandName}>SnapBook</Text>
        </View>
        <View style={styles.navActions}>
          <TouchableOpacity style={styles.linkPill} onPress={() => navigation.navigate('Auth')}>
            <Text style={styles.linkText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.linkPill, styles.linkFilled]} onPress={() => navigation.navigate('Auth')}>
            <Text style={[styles.linkText, styles.linkFilledText]}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.hero, !isWideHero && styles.heroStacked]}>
        <View style={[styles.heroText, !isWideHero && styles.heroTextCentered]}>
          <Text style={styles.eyebrow}>Preview</Text>
          <Text style={[styles.title, !isWideHero && styles.titleCentered]}>Find the Perfect Photographer for Your Moments</Text>
          <Text style={[styles.subtitle, !isWideHero && styles.subtitleCentered]}>
            Connect with professional photographers in your area. Browse, compare, and book in minutes.
          </Text>
          <View style={[styles.searchCard, !isWideHero && styles.searchCardFull]}>
            <View style={[styles.searchRow, !isWideHero && styles.searchRowStacked]}>
              <View style={[styles.inputGroup, styles.inputSpacer, !isWideHero && styles.inputGroupBlock]}>
                <Ionicons name="location-outline" size={18} color="#0f172a" />
                <View style={styles.inputContent}>
                  <Text style={styles.inputLabel}>Location</Text>
                  <TextInput
                    placeholder="Enter your location"
                    value={location}
                    onChangeText={setLocation}
                    style={styles.input}
                    placeholderTextColor="#94a3b8"
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, styles.dropdown, !isWideHero && styles.inputGroupBlock]}>
                <Ionicons name="camera-outline" size={18} color="#0f172a" />
                <View style={styles.inputContent}>
                  <Text style={styles.inputLabel}>Category</Text>
                  <View style={styles.dropdownRow}>
                    <Text style={styles.dropdownValue}>{category}</Text>
                    <Ionicons name="chevron-down" size={16} color="#475569" />
                  </View>
                </View>
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}>
              <Ionicons name="search" size={18} color="#fff" />
              <Text style={styles.ctaText}>Find Photographers</Text>
            </Pressable>
          </View>
          <View style={[styles.metricsRow, !isWideHero && styles.metricsRowStacked]}>
            <View style={[styles.metric, styles.metricPrimary]}>
              <Text style={styles.metricValue}>500+</Text>
              <Text style={styles.metricLabel}>Photographers</Text>
            </View>
            <View style={[styles.metric, styles.metricSecondary]}>
              <Text style={styles.metricValue}>10k+</Text>
              <Text style={styles.metricLabel}>Happy Customers</Text>
            </View>
            <View style={[styles.metric, styles.metricTertiary]}>
              <Text style={styles.metricValue}>4.9</Text>
              <Text style={styles.metricLabel}>Average Rating</Text>
            </View>
          </View>
        </View>
        <View style={[styles.heroCard, !isWideHero && styles.heroCardWide]}>
          <Ionicons name="search" size={54} color="#0f172a" />
          <Text style={styles.heroCardTitle}>Find Your Perfect Photographer</Text>
        </View>
      </View>

      <View style={styles.filtersCard}>
        <Text style={styles.sectionTitle}>Filters</Text>
        <View style={styles.filtersRow}>
          {['All Categories', 'Wedding', 'Portrait', 'Event', 'Family'].map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.filterPill, category === item && styles.filterPillActive]}
              onPress={() => setCategory(item)}
            >
              <Text style={[styles.filterText, category === item && styles.filterTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filtersGrid}>
          <TouchableOpacity style={styles.filterBox} onPress={() => setPriceRange(priceRange === 'Any budget' ? '$$' : 'Any budget')}>
            <Text style={styles.filterLabel}>Price Range</Text>
            <Text style={styles.filterValue}>{priceRange === 'Any budget' ? '$50+' : priceRange}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterBox} onPress={() => setSort(sort === 'Highest Rated' ? 'Nearest' : 'Highest Rated')}>
            <Text style={styles.filterLabel}>Sort By</Text>
            <Text style={styles.filterValue}>{sort}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Available Photographers</Text>
          <Text style={styles.sectionSubtitle}>{filteredPhotographers.length} options in your area</Text>
        </View>
        <TouchableOpacity style={styles.lightButton} onPress={() => navigation.navigate('Bookings')}>
          <Ionicons name="calendar-outline" size={16} color="#0f172a" />
          <Text style={styles.lightButtonText}>View Dashboard</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}> 
        {filteredPhotographers.map(renderCard)}
      </View>
      {!filteredPhotographers.length ? (
        <Text style={styles.empty}>{error ? error : 'No photographers match your filters yet.'}</Text>
      ) : null}

      <View style={styles.featureSection}>
        <Text style={styles.sectionTitle}>Explore More Features</Text>
        <Text style={styles.sectionSubtitle}>Discover additional components and functionality of our platform.</Text>
        <View style={styles.featuresRow}>
          <View style={styles.featureCard}>
            <Ionicons name="person-circle-outline" size={32} color="#0f172a" />
            <Text style={styles.featureTitle}>Photographer Profile</Text>
            <Text style={styles.featureCopy}>Detailed pages with portfolios, reviews, and booking.</Text>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('Profile', { photographerId: state.photographers[0]?.id ?? 'p1' })}
            >
              <Text style={styles.outlineText}>View Demo</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="calendar-outline" size={32} color="#0f172a" />
            <Text style={styles.featureTitle}>User Dashboard</Text>
            <Text style={styles.featureCopy}>Manage bookings, view history, and adjust account settings.</Text>
            <TouchableOpacity style={styles.outlineButton} onPress={() => navigation.navigate('Bookings')}>
              <Text style={styles.outlineText}>View Demo</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.featureCard}>
            <Ionicons name="color-palette-outline" size={32} color="#0f172a" />
            <Text style={styles.featureTitle}>Design System</Text>
            <Text style={styles.featureCopy}>Consistent components and tokens across the experience.</Text>
            <TouchableOpacity style={styles.outlineButton} onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.outlineText}>View Demo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  navActions: {
    flexDirection: 'row',
    marginLeft: 10,
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
    backgroundColor: '#e8edff',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
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
  eyebrow: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '700',
    color: '#0f172a',
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
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    marginTop: 14,
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
  },
  empty: {
    textAlign: 'center',
    marginTop: 16,
    color: '#475569',
  },
  featureSection: {
    marginTop: 20,
  },
  featuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  featureCard: {
    flex: 1,
    minWidth: 240,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    margin: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  featureTitle: {
    fontWeight: '800',
    color: '#0f172a',
    fontSize: 16,
  },
  featureCopy: {
    color: '#475569',
    lineHeight: 20,
  },
  outlineButton: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0f172a',
    alignItems: 'center',
  },
  outlineText: {
    color: '#0f172a',
    fontWeight: '800',
  },
});

export default HomeScreen;
