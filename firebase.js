import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyAg9uJRk5jpTdR7FU5u1y83ENBHvngMiVo",
  authDomain: "pankiechat-v2-e7d4a.firebaseapp.com",
  databaseURL: "https://pankiechat-v2-e7d4a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pankiechat-v2-e7d4a",
  storageBucket: "pankiechat-v2-e7d4a.firebasestorage.app",
  messagingSenderId: "474712926960",
  appId: "1:474712926960:web:e6b0d5ecb4b06219393035"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
