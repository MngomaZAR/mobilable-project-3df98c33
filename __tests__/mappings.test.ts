// FIX: mapPostRow lives in mappings.ts, not feedMappings (file doesn't exist)
// FIX: Photographer uses avatar_url not avatar
import { mapPhotographerRow, mapSupabaseUser, mapPostRow } from '../src/utils/mappings';

describe('mapping helpers', () => {
  test('mapPhotographerRow maps DB row to Photographer', () => {
    const row: any = {
      id: 'p1',
      rating: 4.5,
      location: 'Cape Town',
      latitude: -33.9,
      longitude: 18.4,
      price_range: 'R2000',
      style: 'Wedding',
      bio: 'Bio',
      tags: ['wedding', 'portrait'],
      profiles: [{ id: 'p1', full_name: 'Alex', avatar_url: 'https://example.com/a.png', city: 'Cape Town' }],
    };
    const out = mapPhotographerRow(row as any);
    expect(out.id).toBe('p1');
    expect(out.name).toBe('Alex');
    expect(out.avatar_url).toBe('https://example.com/a.png'); // FIX: was out.avatar
    expect(out.location).toContain('Cape Town');
    expect(out.latitude).toBeCloseTo(-33.9);
  });

  test('mapSupabaseUser respects profile and metadata', () => {
    const user = { id: 'u1', email: 'a@b.com', user_metadata: { role: 'photographer', verified: true } } as any;
    const profile = { role: 'photographer', verified: true } as any;
    const mapped = mapSupabaseUser(user, 'client', profile);
    expect(mapped.id).toBe('u1');
    expect(mapped.role).toBe('photographer');
    expect(mapped.verified).toBe(true);
  });

  test('mapPostRow maps DB row to Post', () => {
    const row: any = {
      id: 'post1',
      author_id: 'u1',
      caption: 'Nice!',
      location: 'Cape Town',
      comment_count: 2,
      created_at: '2026-02-03T00:00:00Z',
      image_url: 'https://example.com/img.jpg',
      likes_count: 5,
      profiles: [{ id: 'u1', full_name: 'Alex', city: 'Cape Town', avatar_url: 'https://example.com/a.png' }],
    };
    const out = mapPostRow(row);
    expect(out.id).toBe('post1');
    expect(out.caption).toBe('Nice!');       // Post uses caption not title
    expect(out.image_url).toBe('https://example.com/img.jpg'); // Post uses image_url not imageUrl
    expect(out.profile?.full_name).toBe('Alex');
  });
});
