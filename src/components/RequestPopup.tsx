import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';

interface RequestPopupProps {
  visible: boolean;
  requestData: any | null;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

export const RequestPopup: React.FC<RequestPopupProps> = ({ visible, requestData, onAccept, onDecline, onDismiss, busy = false }) => {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(100)).current;
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (visible && requestData && !busy) {
      // Vibrate to alert user
      Vibration.vibrate([0, 500, 200, 500]);
      
      // Slide down
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();

      // Reset progress
      progress.setValue(100);

      // Start progress bar descending from 100 to 0 over 15 seconds
      if (requestData.is_instant) Animated.timing(progress, {
        toValue: 0,
        duration: 15000,
        useNativeDriver: false,
      }).start();

      // Hiding an offer must never decline a booking on the server.
      if (requestData.is_instant) timeoutRef.current = setTimeout(() => {
        dismissRef.current();
      }, 15000);
    } else if (busy) {
      clearTimeout(timeoutRef.current);
      progress.stopAnimation();
    } else {
      Animated.timing(slideAnim, {
        toValue: -200,
        duration: 300,
        useNativeDriver: true,
      }).start();
      clearTimeout(timeoutRef.current);
    }
    
    return () => clearTimeout(timeoutRef.current);
  }, [visible, requestData?.id, requestData?.is_instant, busy, progress, slideAnim]);

  if (!requestData) return null;

  const widthInterpolated = progress.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }], backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="flash" size={24} color="#f59e0b" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>New Request</Text>
        <Text style={[styles.price, { color: colors.text }]}>ZAR {requestData.payout_amount}</Text>
      </View>

      <Text style={[styles.details, { color: colors.textSecondary }]}>
        {requestData.booking_date || 'Scheduled booking'}
      </Text>
      <Text style={[styles.package, { color: colors.textSecondary }]}>
        Package: {requestData.package_type}
      </Text>

      <View style={styles.actionRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Decline booking request" disabled={busy} style={[styles.declineBtn, { borderColor: colors.border }]} onPress={onDecline}>
          <Text style={[styles.declineText, { color: colors.text }]}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Accept booking request" disabled={busy} style={[styles.acceptBtn, { backgroundColor: colors.accent }]} onPress={onAccept}>
          <Text style={styles.acceptText}>{busy ? 'Saving...' : 'Accept'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onDismiss} style={styles.dismissBtn}>
        <Text style={{ color: colors.textSecondary }}>Later</Text>
      </TouchableOpacity>
      {requestData.is_instant && <View style={styles.progressBarBg}>
        <Animated.View style={[styles.progressBarFill, { width: widthInterpolated, backgroundColor: colors.accent }]} />
      </View>}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 8,
    padding: 20,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
    borderWidth: 1,
    zIndex: 9999,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    flex: 1,
  },
  price: {
    fontSize: 20,
    fontWeight: '900',
    color: '#10b981',
  },
  details: {
    fontSize: 15,
    marginBottom: 4,
    fontWeight: '600',
  },
  package: {
    fontSize: 14,
    marginBottom: 20,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  declineText: {
    fontSize: 16,
    fontWeight: '700',
  },
  acceptBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  dismissBtn: { alignItems: 'center', paddingBottom: 16, minHeight: 44 },
  progressBarBg: {
    height: 4,
    backgroundColor: 'transparent',
    width: '100%',
    marginLeft: -20,
    marginRight: -20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  },
});
