import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import KYCScreen from '../src/screens/KYCScreen';
import { apiClient } from '../src/config/apiClient';

const mockDocuments = jest.fn();
const mockRevalidate = jest.fn();
const mockChooseImage = jest.fn();
const mockUploadImage = jest.fn();
jest.mock('../src/services/backendGateway', () => ({ backendDb: { from: () => ({ select: () => ({ eq: mockDocuments }) }) } }));
jest.mock('../src/store/AppDataContext', () => ({ useAppData: () => ({ state: { currentUser: { id: 'provider', kyc_status: 'pending' } }, revalidateSession: mockRevalidate }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted' }), launchImageLibraryAsync: (...args: unknown[]) => mockChooseImage(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: async () => ({ uri: 'file://resized', base64: 'image' }), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../src/services/uploadService', () => ({ uploadImage: (...args: unknown[]) => mockUploadImage(...args) }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' } }));
jest.mock('../src/config/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../src/config/apiSession', () => ({ getApiAccessToken: async () => 'synthetic-token' }));

const completeDocuments = [{ doc_type: 'id_book', status: 'pending' }, { doc_type: 'selfie', status: 'pending' }];
beforeEach(() => {
  jest.clearAllMocks();
  mockDocuments.mockResolvedValue({ data: [], error: null });
  mockRevalidate.mockResolvedValue(null);
  mockChooseImage.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://synthetic-document' }] });
  mockUploadImage.mockResolvedValue('kyc-documents/provider/synthetic.jpg');
  (apiClient.post as jest.Mock).mockResolvedValue({});
});

test('loading is distinct from empty documents and cannot submit', async () => {
  let resolve!: (value: unknown) => void;
  mockDocuments.mockReturnValue(new Promise(done => { resolve = done; }));
  const screen = render(<KYCScreen />);
  expect(screen.getByLabelText('Loading identity documents')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeDisabled();
  await act(async () => resolve({ data: [], error: null }));
  expect(screen.queryByLabelText('Loading identity documents')).toBeNull();
  expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeDisabled();
});

test('document read errors have a working retry', async () => {
  mockDocuments.mockResolvedValueOnce({ data: null, error: new Error('Connection interrupted') }).mockResolvedValueOnce({ data: completeDocuments, error: null });
  const screen = render(<KYCScreen />);
  await waitFor(() => expect(screen.getByText('Connection interrupted')).toBeTruthy());
  fireEvent.press(screen.getByRole('button', { name: 'Retry identity documents' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeEnabled());
  expect(mockDocuments).toHaveBeenCalledTimes(2);
});

test('a pending upload blocks parallel uploads and submission until persistence completes', async () => {
  mockDocuments.mockResolvedValue({ data: completeDocuments, error: null });
  let resolve!: (value: unknown) => void;
  (apiClient.post as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const screen = render(<KYCScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeEnabled());
  fireEvent.press(screen.getByRole('button', { name: 'Replace SA ID / Passport' }));
  fireEvent.press(screen.getByRole('button', { name: 'Replace Selfie with ID' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(mockChooseImage).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeDisabled();
  await act(async () => resolve({}));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeEnabled());
});

test('a failed submission keeps uploaded documents and can retry without duplicate requests', async () => {
  mockDocuments.mockResolvedValue({ data: completeDocuments, error: null });
  (apiClient.post as jest.Mock).mockRejectedValueOnce(new Error('Submission interrupted')).mockResolvedValueOnce({});
  const screen = render(<KYCScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeEnabled());
  fireEvent.press(screen.getByRole('button', { name: 'Submit for Review' }));
  await waitFor(() => expect(screen.getByText('Submission interrupted')).toBeTruthy());
  expect(screen.getAllByText('Document uploaded')).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: 'Submit for Review' }));
  fireEvent.press(screen.getByRole('button', { name: 'Submit for Review' }));
  await waitFor(() => expect(screen.getByText('Documents submitted for review.')).toBeTruthy());
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(mockRevalidate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Submit for Review' })).toBeDisabled();
});
