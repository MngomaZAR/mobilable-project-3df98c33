import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('ErrorBoundary caught an error', error);
    this.setState({ errorMessage: error instanceof Error ? error.message : 'Unknown runtime error' });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>Please restart the app or try again.</Text>
          {this.state.errorMessage ? <Text style={styles.details}>{this.state.errorMessage}</Text> : null}
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleRetry}>
            <Text style={styles.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fdf2f8',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
  },
  details: {
    marginTop: 10,
    fontSize: 12,
    color: '#7f1d1d',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 14,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
