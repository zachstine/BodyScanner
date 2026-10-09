import { collection, doc, getDoc, updateDoc, onSnapshot, addDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { connectFirebase, rtcConfig, candidateBuffer, setStatus } from './common.js';

const roomId = new URLSearchParams(location.search).get('room');
const start = document.querySelector('#startCamera');
const stop = document.querySelector('#stopCamera');
const video = document.querySelector('#localVideo');
const indicator = document.querySelector('#connectionState');
let stream, pc, unsubscribers = [], db, roomRef, stopped = false;
function subscribe(unsub) { unsubscribers.push(unsub); }
function cleanup() {
  stopped = true;
  for (const u of unsubscribers.splice(0)) u();
  if (pc) { pc.close(); pc = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  document.querySelector('#placeholder').hidden = false;
  indicator.textContent = 'OFFLINE';
  start.disabled = false; stop.disabled = true;
}
if (!roomId) { setStatus('Missing session ID. Scan the QR code from the viewer page.'); start.disabled = true; }
start.addEventListener('click', async () => {
  start.disabled = true; stopped = false;
  try {
    db ||= await connectFirebase();
    roomRef = doc(db, 'cameraSessions', roomId);
    const snapshot = await getDoc(roomRef);
    if (!snapshot.exists() || snapshot.data().state !== 'waiting') throw new Error('Session expired or already in use. Start a new session on your laptop.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available. Open this page in Safari over HTTPS.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
    video.srcObject = stream;
    await video.play();
    document.querySelector('#placeholder').hidden = true;
    pc = new RTCPeerConnection(rtcConfig);
    const candidates = candidateBuffer(pc);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = e => { if (e.candidate && !stopped) addDoc(collection(roomRef, 'cameraCandidates'), e.candidate.toJSON()).catch(console.error); };
    pc.onconnectionstatechange = () => {
      indicator.textContent = pc.connectionState.toUpperCase();
      if (pc.connectionState === 'connected') setStatus('Broadcasting live video to laptop.');
      if (pc.connectionState === 'failed') setStatus('Connection failed. A TURN relay might be required on this network.');
    };
    subscribe(onSnapshot(collection(roomRef, 'viewerCandidates'), snap => {
      for (const change of snap.docChanges()) if (change.type === 'added') candidates.add(change.doc.data());
    }, err => setStatus(err.message)));
    subscribe(onSnapshot(roomRef, async snap => {
      const data = snap.data();
      if (data?.state === 'ended') { cleanup(); setStatus('Viewer ended the session.'); return; }
      if (data?.answer && !pc?.currentRemoteDescription && !stopped) {
        try { await pc.setRemoteDescription(data.answer); await candidates.flush(); }
        catch (err) { setStatus(`Answer error: ${err.message}`); }
      }
    }, err => setStatus(err.message)));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await updateDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp }, state: 'offered' });
    stop.disabled = false;
    indicator.textContent = 'CONNECTING';
    setStatus('Camera ready. Connecting to laptop…');
  } catch (err) { cleanup(); setStatus(`Cannot start: ${err.message}`); }
});
stop.addEventListener('click', async () => {
  cleanup();
  if (roomRef) { try { await updateDoc(roomRef, { state: 'ended' }); } catch {} }
  setStatus('Camera stopped. Start a new laptop session to reconnect.');
  start.disabled = true;
});
window.addEventListener('pagehide', () => { if (stream) stream.getTracks().forEach(t => t.stop()); });
