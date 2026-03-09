import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../store/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  iconName?: keyof typeof Ionicons.glyphMap;
};

const AccessDeniedScreen: React.FC<Props> = ({ 
  title, 
  message, 
  actionLabel, 
  onAction,
  iconName = 'lock-closed'
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.iconContainer, { backgroundColor: colors.destructive + '15' }]}>
          <Ionicons name={iconName} size={48} color={colors.destructive} />
        </View>
        
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.text }]} 
          onPress={onAction}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, { color: colors.bg }]}>{actionLabel}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.bg} style={{ marginLeft: 8 }} />
        </TouchableOpacity>
        
        {Platform.OS !== 'web' && (
          <TouchableOpacity style={styles.supportLink}>
            <Text style={[styles.supportText, { color: colors.textMuted }]}>
              Still having trouble? <Text style={{ color: colors.accent, fontWeight: '700' }}>Contact Support</Text>
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  button: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
  },
  supportLink: {
    marginTop: 24,
  },
  supportText: {
    fontSize: 14,
  },
});

export default AccessDeniedScreen;
