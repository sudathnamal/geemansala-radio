import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform, AppState } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';

const RADIO_STREAM_URL = 'https://dosthara.org/listen/geemansala_radio/radio.mp3';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  
  const appState = useRef(AppState.currentState);
  const notificationId = useRef(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    initializeApp();
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription?.remove();
      cleanup();
    };
  }, []);

  const initializeApp = async () => {
    try {
      await requestPermissions();
      await loadStoredVolume();
      await setupAudioMode();
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  };

  const requestPermissions = async () => {
    try {
      await Notifications.requestPermissionsAsync();
    } catch (error) {
      console.error('Permission request failed:', error);
    }
  };

  const setupAudioMode = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('Failed to set audio mode:', error);
    }
  };

  const loadStoredVolume = async () => {
    try {
      const storedVolume = await AsyncStorage.getItem('radio_volume');
      if (storedVolume) {
        setVolume(parseFloat(storedVolume));
      }
    } catch (error) {
      console.error('Failed to load stored volume:', error);
    }
  };

  const saveVolume = async (newVolume) => {
    try {
      await AsyncStorage.setItem('radio_volume', newVolume.toString());
    } catch (error) {
      console.error('Failed to save volume:', error);
    }
  };

  const handleAppStateChange = async (nextAppState) => {
    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
      if (notificationId.current) {
        await Notifications.dismissNotificationAsync(notificationId.current);
        notificationId.current = null;
      }
    } else if (nextAppState.match(/inactive|background/) && isPlaying) {
      await showBackgroundNotification();
    }
    appState.current = nextAppState;
  };

  const showBackgroundNotification = async () => {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'GeeMansala Radio Stream',
          body: 'Currently playing • Tap to return to app',
        },
        trigger: null,
      });
      notificationId.current = id;
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  };

  const playStream = async () => {
    if (isPlaying || isLoading) return;

    setIsLoading(true);
    setConnectionStatus('connecting');
    
    try {
      if (sound) {
        await sound.unloadAsync();
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: RADIO_STREAM_URL },
        { shouldPlay: true, volume: volume }
      );

      setSound(newSound);
      setIsPlaying(true);
      setConnectionStatus('connected');
      reconnectAttempts.current = 0;
      
    } catch (error) {
      console.error('Failed to play stream:', error);
      setConnectionStatus('error');
      setIsPlaying(false);
      
      if (reconnectAttempts.current < 5) {
        reconnectAttempts.current++;
        setTimeout(playStream, 2000 * reconnectAttempts.current);
      } else {
        Alert.alert('Connection Error', 'Unable to connect to radio stream');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const stopStream = async () => {
    try {
      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
        setSound(null);
      }
      setIsPlaying(false);
      setConnectionStatus('idle');
      if (notificationId.current) {
        await Notifications.dismissNotificationAsync(notificationId.current);
        notificationId.current = null;
      }
    } catch (error) {
      console.error('Failed to stop stream:', error);
    }
  };

  const changeVolume = async (newVolume) => {
    setVolume(newVolume);
    await saveVolume(newVolume);
    if (sound) {
      try {
        await sound.setVolumeAsync(newVolume);
      } catch (error) {
        console.error('Failed to set volume:', error);
      }
    }
  };

  const adjustVolume = (increment) => {
    const newVolume = Math.max(0, Math.min(1, volume + increment));
    changeVolume(newVolume);
  };

  const cleanup = async () => {
    if (sound) {
      await sound.unloadAsync();
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connecting': return 'Connecting...';
      case 'connected': return 'Connected • GeeMansala Radio';
      case 'error': return 'Connection Error';
      default: return 'Ready to play';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connecting': return '#FF9500';
      case 'connected': return '#34C759';
      case 'error': return '#FF3B30';
      default: return '#8E8E93';
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      <View style={styles.header}>
        <Text style={styles.title}>GeeMansala Radio Stream</Text>
        <View style={styles.statusContainer}>
          <View style={[styles.statusDot, { backgroundColor: getConnectionStatusColor() }]} />
          <Text style={[styles.statusText, { color: getConnectionStatusColor() }]}>
            {getConnectionStatusText()}
          </Text>
        </View>
      </View>

      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.mainButton, isLoading && styles.mainButtonDisabled]}
          onPress={isPlaying ? stopStream : playStream}
          disabled={isLoading}
        >
          {isLoading ? (
            <Ionicons name="refresh" size={48} color="#FFFFFF" style={{ opacity: 0.7 }} />
          ) : (
            <Ionicons name={isPlaying ? "stop" : "play"} size={48} color="#FFFFFF" />
          )}
        </TouchableOpacity>
        <Text style={styles.buttonLabel}>
          {isLoading ? 'Connecting...' : (isPlaying ? 'Stop' : 'Play')}
        </Text>
      </View>

      <View style={styles.volumeContainer}>
        <Text style={styles.volumeLabel}>Volume Control</Text>
        
        <View style={styles.volumeButtons}>
          <TouchableOpacity style={styles.volumeButton} onPress={() => adjustVolume(-0.1)}>
            <Ionicons name="volume-low" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.volumeButton} onPress={() => adjustVolume(0.1)}>
            <Ionicons name="volume-high" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.sliderContainer}>
          <Ionicons name="volume-mute" size={20} color="#8E8E93" />
          <Slider
            style={styles.slider}
            value={volume}
            onValueChange={changeVolume}
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#8E8E93"
          />
          <Ionicons name="volume-high" size={20} color="#8E8E93" />
        </View>
        
        <Text style={styles.volumeValue}>{Math.round(volume * 100)}%</Text>
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>Stream URL: {RADIO_STREAM_URL}</Text>
        <Text style={styles.infoText}>• Plays in background</Text>
        <Text style={styles.infoText}>• Notification controls when minimized</Text>
        <Text style={styles.infoText}>• Auto-reconnect on connection loss</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    paddingTop: Platform.OS === 'android' ? 50 : 80,
    paddingHorizontal: 20,
  },
  header: { alignItems: 'center', marginBottom: 40 },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  statusContainer: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 16, fontWeight: '500' },
  controlsContainer: { alignItems: 'center', marginBottom: 50 },
  mainButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
  },
  mainButtonDisabled: { backgroundColor: '#3A3A3C' },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  volumeContainer: { marginBottom: 40 },
  volumeLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  volumeButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 40,
  },
  volumeButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  slider: { flex: 1, height: 40, marginHorizontal: 15 },
  volumeValue: {
    color: '#8E8E93',
    fontSize: 16,
    textAlign: 'center',
  },
  infoContainer: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3A3A3C',
  },
  infoText: {
    color: '#8E8E93',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
});