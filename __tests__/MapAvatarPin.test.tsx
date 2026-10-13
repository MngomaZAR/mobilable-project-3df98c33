import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MapAvatarPin } from '../src/components/MapAvatarPin';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

test('missing photo uses a local pin icon without requesting a remote placeholder', () => {
  const view = render(<MapAvatarPin label="Creator" />);
  expect(view.queryByTestId('map-pin-photo')).toBeNull();
  expect(view.getByText('Creator')).toBeTruthy();
});

test('failed remote photo falls back and refreshes the native annotation', () => {
  const refresh = jest.fn();
  const view = render(<MapAvatarPin uri="https://example.com/missing.jpg" onImageLoad={refresh} />);
  fireEvent(view.getByTestId('map-pin-photo'), 'error');
  expect(view.queryByTestId('map-pin-photo')).toBeNull();
  expect(refresh).toHaveBeenCalled();
});
