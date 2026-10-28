import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  uri?: string | null;
  size?: number;
  online?: boolean;
  rating?: number | null;
  label?: string;
  onImageLoad?: () => void;
};

export const MapAvatarPin: React.FC<Props> = ({ uri, size = 58, online = false, rating, label, onImageLoad }) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => { setImageFailed(false); }, [uri]);
  useEffect(() => {
    if (imageFailed) onImageLoad?.();
  }, [imageFailed, onImageLoad]);

  const ringColor = online ? '#f1d6a4' : '#c7b293';

  return (
    <View style={styles.shell}>
      <View style={[styles.wrap, { width: size, height: size }]}>
        <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: ringColor }]} />
        <View
          style={[
            styles.avatarWrap,
            {
              width: size - 10,
              height: size - 10,
              borderRadius: (size - 10) / 2,
            },
          ]}
        >
          {uri && !imageFailed ? (
            <Image testID="map-pin-photo" source={{ uri }} style={styles.avatar} onLoad={onImageLoad} onError={() => setImageFailed(true)} />
          ) : (
            <Ionicons name="camera" size={21} color="#334155" />
          )}
        </View>
        {Number.isFinite(rating) && (
          <View style={[styles.ratingBadge, { right: -2, bottom: -4 }]}>
            <Ionicons name="star" size={10} color="#fbbf24" />
            <View style={styles.ratingTextWrap}>
              <Text style={styles.ratingText}>{Number(rating).toFixed(1)}</Text>
            </View>
          </View>
        )}
        {online ? <View style={styles.onlineDot} /> : null}
      </View>
      {label ? (
        <View style={styles.labelWrap}>
          <Text numberOfLines={1} style={styles.labelText}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
  },
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 3,
    shadowColor: '#d6b483',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatarWrap: {
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fffaf3',
    backgroundColor: '#ffffff',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(241, 214, 164, 0.6)',
  },
  onlineDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: 4,
    right: 4,
    backgroundColor: '#34d399',
    borderWidth: 2,
    borderColor: '#fffaf3',
  },
  ratingTextWrap: {
    minWidth: 24,
    alignItems: 'center',
  },
  ratingText: {
    color: '#f5e7cc',
    fontWeight: '800',
    fontSize: 10,
  },
  labelWrap: {
    marginTop: 5,
    maxWidth: 96,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  labelText: {
    color: '#fff6e8',
    fontSize: 10,
    fontWeight: '700',
  },
});
