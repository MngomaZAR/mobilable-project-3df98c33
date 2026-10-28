import React from 'react';
import { View } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import { MapTracker } from '../src/components/MapTracker.native';
import { useRoadRoute } from '../src/hooks/useRoadRoute';

jest.mock('../src/hooks/useRoadRoute', () => ({ useRoadRoute: jest.fn() }));
jest.mock('../src/components/MapLibreWrapper', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Box = ({ children, ...props }: any) => React.createElement(View, props, children);
  return {
    isMapLibreNativeAvailable: true,
    MapLibreGL: {
      MapView: Box,
      Camera: () => null,
      ShapeSource: ({ children, ...props }: any) => React.createElement(View, { ...props, testID: 'road-route' }, children),
      LineLayer: () => null,
      PointAnnotation: Box,
    },
  };
});

const client = { latitude: -29.8587, longitude: 31.0218 };
const photographer = { latitude: -29.87, longitude: 31.04 };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('does not draw a direct line when road routing is unavailable', () => {
  (useRoadRoute as jest.Mock).mockReturnValue({ status: 'unavailable', coordinates: [] });

  const screen = render(<MapTracker client={client} photographer={photographer} status="in_progress" />);

  expect(screen.queryByTestId('road-route')).toBeNull();
  expect(screen.getByText('Road route unavailable')).toBeTruthy();
  expect(useRoadRoute).toHaveBeenCalledWith(photographer, client);
});

test('renders only verified street geometry from the road-routing hook', () => {
  const coordinates = [[31.04, -29.87], [31.03, -29.865], [31.0218, -29.8587]];
  (useRoadRoute as jest.Mock).mockReturnValue({ status: 'ready', coordinates });

  const screen = render(<MapTracker client={client} photographer={photographer} status="in_progress" />);

  expect(screen.getByTestId('road-route').props.shape.geometry.coordinates).toEqual(coordinates);
  expect(screen.queryByText('Road route unavailable')).toBeNull();
});
