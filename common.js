import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export async function connectFirebase() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'REPLACE_ME') {
    throw new Error('Firebase is not configured. Edit config.js first (see README).');
  }
  const app = initializeApp(firebaseConfig);
  await signInAnonymously(getAuth(app));
  return getFirestore(app);
}

export const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

// ICE candidates can arrive before setRemoteDescription; buffer until ready.
export function candidateBuffer(pc) {
  let queue = [];
  return {
    async add(candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('ICE candidate failed', e); }
      } else { queue.push(candidate); }
    },
    async flush() {
      const pending = queue;
      queue = [];
      for (const c of pending) await this.add(c);
    }
  };
}

export function setStatus(message) {
  document.getElementById('status').textContent = message;
}
