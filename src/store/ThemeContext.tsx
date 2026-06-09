import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, ColorSchemeName } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeColors = {
  bg: string;
  card: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  destructive: string;
  successGreen: string;
};

const LIGHT: ThemeColors = {
  bg: '#f3ede4',
  card: 'rgba(255, 250, 244, 0.74)',
  border: 'rgba(148, 115, 74, 0.18)',
  text: '#201a15',
  textSecondary: '#4b4339',
  textMuted: '#7e7162',
  accent: '#b8894f',
  destructive: '#ef4444',
  successGreen: '#2bb673',
};

const DARK: ThemeColors = {
  bg: '#07111f',
  card: 'rgba(15, 23, 42, 0.76)',
  border: 'rgba(255, 255, 255, 0.10)',
  text: '#f7f2e8',
  textSecondary: '#d7c8af',
  textMuted: '#a0aec0',
  accent: '#f2c98b',
  destructive: '#ff453a',
  successGreen: '#3ccf8e',
};

type ThemeContextValue = {
  themeMode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  themeMode: 'system',
  isDark: false,
  colors: LIGHT,
  setThemeMode: () => {},
});

const STORAGE_KEY = 'papzi-theme-mode';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeModeState(stored);
      }
    });
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const isDark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');

  const colors = isDark ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ themeMode, isDark, colors, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
