import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';

type Navigation = StackNavigationProp<RootStackParamList, 'CreatePost'>;

const CreatePostScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { addPost } = useAppData();
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo access to add an image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (result.canceled) return;

    try {
      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      setImageUri(manipulated.uri);
    } catch (err) {
      console.warn('Image processing failed', err);
      setImageUri(result.assets[0]?.uri ?? null);
    }
  };

  const handleSubmit = async () => {
    if (!imageUri || !caption.trim()) {
      Alert.alert('Add photo', 'Please choose an image and write a caption.');
      return;
    }
    setWorking(true);
    await addPost({ caption, imageUri, location });
    setWorking(false);
    navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create a post</Text>
      <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.preview} />
        ) : (
          <Text style={styles.placeholder}>Tap to add an image</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.label}>Caption</Text>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        placeholder="Describe the shot"
        style={[styles.input, styles.multiline]}
        multiline
      />

      <Text style={styles.label}>Location (optional)</Text>
      <TextInput value={location} onChangeText={setLocation} placeholder="Austin, TX" style={styles.input} />

      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={working}>
        <Text style={styles.ctaText}>{working ? 'Saving...' : 'Post'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f7f7fb',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  imagePicker: {
    height: 240,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  preview: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  placeholder: {
    color: '#475569',
    fontWeight: '700',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  cta: {
    marginTop: 16,
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});

export default CreatePostScreen;
