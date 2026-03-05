import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../config/supabaseClient';
import { useAppData } from '../store/AppDataContext';
import { RootStackParamList } from '../navigation/types';
import { uid } from '../utils/id';

type Navigation = StackNavigationProp<RootStackParamList, 'CreatePost'>;

const CreatePostScreen: React.FC = () => {
  const navigation = useNavigation<Navigation>();
  const { addPost, currentUser } = useAppData();
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [uploadPath, setUploadPath] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo access to add an image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (result.canceled) return;

    try {
      const asset = result.assets[0];
      const actions: ImageManipulator.Action[] = [];
      if (asset.width && asset.width > 2048) {
        actions.push({ resize: { width: 2048 } });
      }
      const manipulated = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.95,
        format: ImageManipulator.SaveFormat.JPEG,
      });
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
    if (!currentUser?.id) {
      Alert.alert('Sign in required', 'Please sign in before creating a post.');
      return;
    }
    setWorking(true);
    setSubmitError(null);
    setSubmitStatus('Preparing upload...');
    setUploadPath(null);
    setPublicUrl(null);
    try {
      const path = `posts/${currentUser.id}/${uid('post')}.jpg`;
      setUploadPath(path);
      const response = await fetch(imageUri);
      const blob = await response.blob();
      setSubmitStatus('Uploading image...');
      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) {
        throw uploadError;
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from('post-images')
        .createSignedUrl(path, 60 * 60);
      if (signedError) {
        throw signedError;
      }
      const nextUrl = signedData?.signedUrl;
      setPublicUrl(nextUrl ?? null);

      setSubmitStatus('Saving post...');
      await addPost({ caption, imageUri: path, location, userId: currentUser.id });
      Alert.alert('Post created', 'Your post is live on the feed.');
      navigation.goBack();
    } catch (err: any) {
      const message = err?.message ?? 'Unable to upload the image right now.';
      setSubmitError(message);
      Alert.alert('Upload failed', message);
    } finally {
      setSubmitStatus(null);
      setWorking(false);
    }
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
      {submitStatus ? <Text style={styles.statusText}>{submitStatus}</Text> : null}
      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
      {(uploadPath || publicUrl) ? (
        <View style={styles.debugPanel}>
          <Text style={styles.debugTitle}>Debug</Text>
          {uploadPath ? <Text style={styles.debugText}>Upload path: {uploadPath}</Text> : null}
          {publicUrl ? <Text style={styles.debugText}>Signed URL: {publicUrl}</Text> : null}
        </View>
      ) : null}
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
  subtitle: {
    color: '#475569',
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
  statusText: {
    color: '#0f172a',
    fontWeight: '700',
    marginTop: 10,
  },
  errorText: {
    color: '#b45309',
    fontWeight: '700',
    marginTop: 10,
  },
  debugPanel: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  debugTitle: {
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  debugText: {
    color: '#475569',
  },
});

export default CreatePostScreen;
