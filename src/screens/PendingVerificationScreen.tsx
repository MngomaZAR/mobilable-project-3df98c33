import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, Text, TouchableOpacity, View, Animated, Easing } from 'react-native';
import { AppLogo } from '../components/AppLogo';
import { useAppData } from '../store/AppDataContext';
import { useTheme } from '../store/ThemeContext';

const PendingVerificationScreen: React.FC = () => {
  const { currentUser, revalidateSession, signOut } = useAppData();
  const { colors, isDark } = useTheme();
  const [checking, setChecking] = useState(false);
  
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const refreshStatus = async () => {
    setChecking(true);
    try {
      await revalidateSession();
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <AppLogo size={90} />
          <View style={styles.pulseContainer}>
             <Animated.View style={[styles.pulseCircle, { 
               backgroundColor: colors.accent + '20',
               transform: [{ scale: pulseAnim }] 
             }]} />
             <View style={[styles.innerCircle, { backgroundColor: colors.accent }]}>
                <Ionicons name="time" size={32} color={isDark ? colors.bg : '#fff'} />
             </View>
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Profile Under Review</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Thanks for joining Papzi. Our team is currently reviewing your photographer details to ensure marketplace quality.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={[styles.statusIcon, { backgroundColor: colors.bg }]}>
              <Ionicons name="person" size={20} color={colors.text} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.label, { color: colors.textMuted }]}>CREATOR EMAIL</Text>
              <Text style={[styles.value, { color: colors.text }]}>{currentUser?.email ?? 'Unknown user'}</Text>
            </View>
          </View>
          
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={[styles.statusIcon, { backgroundColor: colors.bg }]}>
              <Ionicons name="shield-checkmark" size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.label, { color: colors.textMuted }]}>CURRENT STATUS</Text>
              <Text style={[styles.value, { color: colors.accent, fontWeight: '800' }]}>AWAITING MANUAL REVIEW</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                We usually approve accounts within 12-24 hours.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.primary, { backgroundColor: colors.text }]} 
            onPress={refreshStatus} 
            disabled={checking}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryText, { color: colors.bg }]}>
              {checking ? 'Synchronizing...' : 'Refresh Status'}
            </Text>
            {!checking && <Ionicons name="refresh" size={18} color={colors.bg} style={{ marginLeft: 8 }} />}
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.secondary} onPress={signOut}>
            <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.notificationBox, { backgroundColor: colors.accent + '10' }]}>
          <Ionicons name="notifications-outline" size={20} color={colors.accent} />
          <Text style={[styles.notificationText, { color: colors.accent }]}>
            We'll send you a push notification and an email as soon as your account is active.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  pulseContainer: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  pulseCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  innerCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
    fontSize: 15,
    paddingHorizontal: 10,
  },
  card: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rowText: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  value: {
    fontSize: 16,
    marginTop: 2,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  actions: {
    marginTop: 8,
  },
  primary: {
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '800',
  },
  secondary: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '700',
  },
  notificationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  notificationText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
});

export default PendingVerificationScreen;
