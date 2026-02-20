/**
 * Firebase Configuration
 * Expo Go compatible using Firebase JS SDK v11
 */

import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyDni_yeEyGfLWYcgB15O2jE8uprAIBFJxE",
  authDomain: "cachebash-app.firebaseapp.com",
  projectId: "cachebash-app",
  storageBucket: "cachebash-app.firebasestorage.app",
  messagingSenderId: "922749444863",
  appId: "1:922749444863:web:db02ac6cfc0769aa3c62ca",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with React Native persistence
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Initialize Firestore
const db = getFirestore(app);

export { app, auth, db };
