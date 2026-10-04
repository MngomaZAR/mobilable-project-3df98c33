import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRoadRoute } from '../src/hooks/useRoadRoute';
import { routingService, RouteResponse } from '../src/services/routingService';

jest.mock('../src/services/routingService', () => ({ routingService: { getRoute: jest.fn() } }));
const start = { latitude: -26.2041, longitude: 28.0473 };
const end = { latitude: -26.196, longitude: 28.05 };
const route: RouteResponse = { coordinates: [[28.0473, -26.2041], [28.048, -26.2], [28.05, -26.196]], distance: 1.3, duration: 95, source: 'osrm' };
beforeEach(() => jest.resetAllMocks());

test('accepts snapped road geometry and actual duration without altering ETA', async () => {
  (routingService.getRoute as jest.Mock).mockResolvedValue(route);
  const view = renderHook(() => useRoadRoute(start, end));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(view.result.current.coordinates).toEqual(route.coordinates);
  expect(view.result.current.durationSec).toBe(95);
  expect(view.result.current.distanceKm).toBe(1.3);
});

test.each(['fallback', 'invalid', 'distant-snap', 'missing-eta', 'negative-distance', 'network'])('%s never creates a road line or ETA', async kind => {
  const candidate = { ...route };
  if (kind === 'fallback') candidate.source = 'fallback';
  if (kind === 'invalid') candidate.coordinates = [[NaN, -26.2], [28.05, -26.196]];
  if (kind === 'distant-snap') candidate.coordinates = [[18.424, -33.925], [28.05, -26.196]];
  if (kind === 'missing-eta') candidate.duration = 0;
  if (kind === 'negative-distance') candidate.distance = -1;
  if (kind === 'network') (routingService.getRoute as jest.Mock).mockRejectedValue(new Error('Network interrupted'));
  else (routingService.getRoute as jest.Mock).mockResolvedValue(candidate);
  const view = renderHook(() => useRoadRoute(start, end));
  await waitFor(() => expect(view.result.current.status).toBe('unavailable'));
  expect(view.result.current.coordinates).toEqual([]);
  expect(view.result.current.durationSec).toBeNull();
  expect(view.result.current.distanceKm).toBeNull();
});

test('an old destination response cannot overwrite a newer destination', async () => {
  let oldResult!: (route: RouteResponse) => void;
  (routingService.getRoute as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve; }))
    .mockResolvedValueOnce({ ...route, duration: 140 });
  const view = renderHook(({ destination }) => useRoadRoute(start, destination), { initialProps: { destination: end } });
  const destination = { latitude: -26.195, longitude: 28.051 };
  view.rerender({ destination });
  await waitFor(() => expect(view.result.current.durationSec).toBe(140));
  await act(async () => { oldResult(route); });
  expect(view.result.current.durationSec).toBe(140);
});

test('changing or clearing destination immediately discards the previous road line', async () => {
  (routingService.getRoute as jest.Mock).mockResolvedValueOnce(route).mockImplementation(() => new Promise(() => {}));
  const view = renderHook(({ destination }: { destination: typeof end | null }) => useRoadRoute(start, destination), { initialProps: { destination: end as typeof end | null } });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  view.rerender({ destination: { latitude: -26.195, longitude: 28.051 } });
  expect(view.result.current.status).toBe('loading');
  expect(view.result.current.coordinates).toEqual([]);
  view.rerender({ destination: null });
  expect(view.result.current.status).toBe('idle');
  expect(view.result.current.durationSec).toBeNull();
});

test('retry recovers a failed road request and ignores unstable object identity', async () => {
  (routingService.getRoute as jest.Mock).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(route);
  const view = renderHook(() => useRoadRoute({ ...start }, { ...end }));
  await waitFor(() => expect(view.result.current.status).toBe('unavailable'));
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  view.rerender();
  expect(routingService.getRoute).toHaveBeenCalledTimes(2);
});

test('invalid or missing locations cannot invoke road routing', () => {
  const view = renderHook(() => useRoadRoute(null, end));
  expect(view.result.current.status).toBe('idle');
  expect(routingService.getRoute).not.toHaveBeenCalled();
});
