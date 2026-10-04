jest.mock('../src/services/backendGateway', () => ({ backendDb: { from: jest.fn() } }));
jest.mock('../src/config/currentUser', () => ({ requireCurrentAuthenticatedUser: jest.fn() }));
jest.mock('../src/config/environment', () => ({ environment: { backendProvider: 'api' }, BUCKETS: { posts: 'posts' } }));
jest.mock('../src/config/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../src/config/apiSession', () => ({ getApiAccessToken: jest.fn() }));
jest.mock('../src/services/uploadService', () => ({ resolveStorageRef: jest.fn() }));

import { backendDb } from '../src/services/backendGateway';
import { requireCurrentAuthenticatedUser } from '../src/config/currentUser';
import { apiClient } from '../src/config/apiClient';
import { resolveStorageRef } from '../src/services/uploadService';
import { fetchCreatorPosts, fetchCreatorProfile } from '../src/services/creatorProfileService';
import { toggleFollow } from '../src/services/followService';
import { fetchPublishedReviewSummary } from '../src/services/reviewService';

const from = backendDb.from as jest.Mock;
const query = (result: object) => {
  const builder: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
  for (const name of ['select', 'eq', 'maybeSingle', 'order', 'limit', 'insert', 'delete']) builder[name] = jest.fn(() => builder);
  return builder;
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireCurrentAuthenticatedUser as jest.Mock).mockResolvedValue({ id: 'client' });
});

test('cold model profile loads the correct talent table without a cached creator list', async () => {
  const profile = { id: 'model', role: 'model', full_name: 'Thandi', verified: true, age_verified: true };
  from.mockReturnValueOnce(query({ data: profile, error: null })).mockReturnValueOnce(query({ data: { id: 'model' }, error: null }));
  const result = await fetchCreatorProfile('model');
  expect(from.mock.calls.map(args => args[0])).toEqual(['profiles', 'models']);
  expect(result?.talent?.name).toBe('Thandi');
});

test('missing profile differs from an API failure', async () => {
  from.mockReturnValueOnce(query({ data: null, error: null }));
  await expect(fetchCreatorProfile('missing')).resolves.toBeNull();
  from.mockReturnValueOnce(query({ data: null, error: { message: 'Request timed out' } }));
  await expect(fetchCreatorProfile('missing')).rejects.toThrow('Request timed out');
});

test('creator detail failures are not presented as a client profile', async () => {
  from.mockReturnValueOnce(query({ data: { role: 'photographer' }, error: null }))
    .mockReturnValueOnce(query({ data: null, error: { message: 'Connection unavailable' } }));
  await expect(fetchCreatorProfile('creator')).rejects.toThrow('Connection unavailable');
});

test('recent work resolves storage references before rendering', async () => {
  from.mockReturnValueOnce(query({ data: [{ id: 'post', image_url: 'owned/path.jpg' }], error: null }));
  (resolveStorageRef as jest.Mock).mockResolvedValue('https://storage.example/owned/path.jpg');
  await expect(fetchCreatorPosts('creator')).resolves.toEqual([{ id: 'post', image_url: 'https://storage.example/owned/path.jpg' }]);
  expect(resolveStorageRef).toHaveBeenCalledWith('owned/path.jpg', 'posts');
});

test('media request failures are not empty portfolios', async () => {
  from.mockReturnValueOnce(query({ data: null, error: { message: 'Offline' } }));
  await expect(fetchCreatorPosts('creator')).rejects.toThrow('Offline');
});

test('first follow accepts a missing optional row and writes the authenticated actor', async () => {
  const lookup = query({ data: null, error: null });
  const write = query({ error: null });
  from.mockReturnValueOnce(lookup).mockReturnValueOnce(write);
  await expect(toggleFollow('creator')).resolves.toBe(true);
  expect(lookup.maybeSingle).toHaveBeenCalled();
  expect(write.insert).toHaveBeenCalledWith({ follower_id: 'client', following_id: 'creator' });
});

test('unfollow checks deletion failure instead of reporting success', async () => {
  from.mockReturnValueOnce(query({ data: { id: 'follow' }, error: null }))
    .mockReturnValueOnce(query({ error: { message: 'Write unavailable' } }));
  await expect(toggleFollow('creator')).rejects.toEqual({ message: 'Write unavailable' });
});

test('follow lookup failure cannot create a duplicate and self-follow is refused', async () => {
  from.mockReturnValueOnce(query({ data: null, error: { message: 'Offline' } }));
  await expect(toggleFollow('creator')).rejects.toEqual({ message: 'Offline' });
  expect(from).toHaveBeenCalledTimes(1);
  await expect(toggleFollow('client')).rejects.toThrow('Choose another creator');
});

test('published reputation comes from the complete API aggregate, not cached ratings', async () => {
  (apiClient.get as jest.Mock).mockResolvedValue({ count: 256, average: 4.7 });
  await expect(fetchPublishedReviewSummary('creator/a')).resolves.toEqual({ count: 256, average: 4.7 });
  expect(apiClient.get).toHaveBeenCalledWith('/reviews/summary/creator%2Fa');
  expect(from).not.toHaveBeenCalled();
});
