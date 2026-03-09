import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../store/ThemeContext';
import { useAuth } from '../store/AuthContext';
import { uploadMediaAsset } from '../services/uploadService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CreatePremiumBox: React.FC<Props> = ({ visible, onClose, onSuccess }) => {
  const { colors } = useTheme();
  const { currentUser } = useAuth();
  
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [priceZar, setPriceZar] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handlePickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleUpload = async () => {
    if (!imageUri || !currentUser) return;
    
    // Validation
    const parsedPrice = isLocked ? parseFloat(priceZar) : 0;
    if (isLocked && (isNaN(parsedPrice) || parsedPrice <= 0)) {
        Alert.alert('Invalid Price', 'Please enter a valid amount greater than 0 ZAR.');
        return;
    }

    setIsUploading(true);
    try {
      const result = await uploadMediaAsset(
          imageUri, 
          currentUser.id, 
          null, // booking_id
          parsedPrice, 
          title
      );
      
      if (result.success) {
        Platform.OS === 'web' ? alert('Premium media posted!') : Alert.alert('Success', 'Media uploaded to your library!');
        resetAndClose();
        if (onSuccess) onSuccess();
      } else {
        const errorMsg = result.error.message || 'Failed to upload premium media.';
        Platform.OS === 'web' ? alert(errorMsg) : Alert.alert('Error', errorMsg);
      }
    } catch (e: any) {
      console.warn(e);
      const friendly = e.message || 'Something went wrong.';
      Platform.OS === 'web' ? alert(friendly) : Alert.alert('Error', friendly);
    } finally {
      setIsUploading(false);
    }
  };

  const resetAndClose = () => {
      setImageUri(null);
      setTitle('');
      setIsLocked(false);
      setPriceZar('');
      onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetAndClose}>
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={resetAndClose} disabled={isUploading}>
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Media</Text>
          <TouchableOpacity onPress={handleUpload} disabled={isUploading || !imageUri}>
            {isUploading ? <ActivityIndicator color={colors.accent} /> : <Text style={[styles.postTxt, { color: !imageUri ? colors.textMuted : colors.accent }]}>Post</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
            <TouchableOpacity 
                style={[styles.imgPicker, { backgroundColor: colors.card, borderColor: colors.border }]} 
                onPress={handlePickImage}
             >
                {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.preview} />
                ) : (
                    <View style={styles.pickerHint}>
                        <Ionicons name="image-outline" size={32} color={colors.textMuted} />
                        <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Select Photo</Text>
                    </View>
                )}
            </TouchableOpacity>

            <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder="Title (Optional)"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
            />

            <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <View>
                    <Text style={[styles.label, { color: colors.text }]}>Pay-per-view lock</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>Require users to pay before viewing.</Text>
                </View>
                <Switch 
                    value={isLocked} 
                    onValueChange={setIsLocked} 
                    trackColor={{ true: colors.accent, false: colors.border }} 
                />
            </View>

            {isLocked && (
                <View style={[styles.row, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.label, { color: colors.text }]}>Price (ZAR)</Text>
                    <TextInput
                        style={[styles.priceInput, { color: colors.text, backgroundColor: colors.card }]}
                        placeholder="0.00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        value={priceZar}
                        onChangeText={setPriceZar}
                    />
                </View>
            )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  postTxt: { fontWeight: '800', fontSize: 16 },
  content: { padding: 20 },
  imgPicker: { height: 200, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', overflow: 'hidden', marginBottom: 20 },
  preview: { width: '100%', height: '100%' },
  pickerHint: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  input: { fontSize: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  priceInput: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, width: 100, textAlign: 'right', fontSize: 16, fontWeight: '700' }
});

export default CreatePremiumBox;
