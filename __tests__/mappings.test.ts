// FIX: mapPostRow lives in mappings.ts, not feedMappings (file doesn't exist)
// FIX: Photographer uses avatar_url not avatar
import { mapBookingRow, mapModelRow, mapPhotographerRow, mapSupabaseUser, mapPostRow } from '../src/utils/mappings';

describe('mapping helpers', () => {
  test('booking mapping preserves the chosen UTC shoot slot, not just the calendar date', () => {
    const row = { id: 'booking', booking_date: '2026-10-14', start_datetime: '2026-10-14T14:00:00Z', end_datetime: '2026-10-14T15:00:00Z', package_id: 'standard', price_total: '1400' };
    const result = mapBookingRow(row);
    expect(result.start_datetime).toBe(row.start_datetime);
    expect(result.end_datetime).toBe(row.end_datetime);
    expect(result.duration_hours).toBe(1);
    expect(result.package_id).toBe('standard');
    expect(result.total_amount).toBe(1400);
  });

  test('booking mapping does not replace an explicit zero with a legacy price', () => {
    expect(mapBookingRow({ id: 'booking', total_amount: 0, price_total: 900 }).total_amount).toBe(0);
  });
  test('mapPhotographerRow maps DB row to Photographer', () => {
    const row: any = {
      id: 'p1',
      rating: 4.5,
      location: 'Cape Town',
      latitude: -33.9,
      longitude: 18.4,
      price_range: 'R2000',
      hourly_rate: '2300.50',
      is_online: true,
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
    expect(out.hourly_rate).toBe(2300.5);
    expect(out.is_online).toBe(true);
  });

  test('missing published rates remain unavailable rather than invented', () => {
    const out = mapPhotographerRow({ id: 'p1', profiles: [] } as any);
    expect(out.hourly_rate).toBeNull();
    expect(out.price_range).toBe('');
    expect(out.is_online).toBe(false);
  });

  test('model mapping preserves published pricing and availability, without fake ratings', () => {
    const out = mapModelRow({ id: 'm1', hourly_rate: '2200', is_online: true,
      portfolio_urls: ['model-media::users/m1/one.jpg'], profiles: [{ full_name: 'QA model', city: 'Durban' }] } as any);
    expect(out.hourly_rate).toBe(2200);
    expect(out.is_online).toBe(true);
    expect(out.rating).toBe(0);
    expect(out.portfolio_urls).toHaveLength(1);
    expect(out.name).toBe('QA model');
    expect(mapModelRow({ id: 'm2', profiles: [] } as any).hourly_rate).toBeNull();
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
