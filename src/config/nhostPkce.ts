import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const PKCE_VERIFIER_KEY = 'nhostPkceVerifier';

export const storeNhostPkceVerifier = async (verifier: string) => {
  await AsyncStorage.setItem(PKCE_VERIFIER_KEY, verifier);
};

export const consumeNhostPkceVerifier = async () => {
  const verifier = await AsyncStorage.getItem(PKCE_VERIFIER_KEY);
  await AsyncStorage.removeItem(PKCE_VERIFIER_KEY);
  return verifier;
};

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

const sha256Base64Url = async (value: string) => {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

export const generateNhostPkcePair = async () => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const verifier = base64UrlEncode(bytes);
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge };
};
