// firebase.js

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const prefix = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? 'NEXT_PUBLIC_' : 'REACT_APP_';
const firebaseConfig = {
  apiKey: process.env[`${prefix}FIREBASE_API_KEY`],
  authDomain: process.env[`${prefix}FIREBASE_AUTH_DOMAIN`],
  projectId: process.env[`${prefix}FIREBASE_PROJECT_ID`],
  storageBucket: process.env[`${prefix}FIREBASE_STORAGE_BUCKET`],
  messagingSenderId: process.env[`${prefix}FIREBASE_MESSAGING_SENDER_ID`],
  appId: process.env[`${prefix}FIREBASE_APP_ID`],
  measurementId: process.env[`${prefix}FIREBASE_MEASUREMENT_ID`]
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };