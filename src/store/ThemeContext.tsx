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
  bg: '#f4f1eb',
  card: '#fffaf2',
  border: '#e8dcc6',
  text: '#2f2a23',
  textSecondary: '#4f463c',
  textMuted: '#8d7f6b',
  accent: '#b08957',
  destructive: '#ef4444',
  successGreen: '#2bb673',
};

const DARK: ThemeColors = {
  bg: '#090f1e',
  card: '#121b2f',
  border: '#2b3750',
  text: '#f7ecd8',
  textSecondary: '#dec8a3',
  textMuted: '#9ba7c0',
  accent: '#dfbf85',
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
