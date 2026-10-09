import { collection, doc, setDoc, updateDoc, onSnapshot, addDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { connectFirebase, rtcConfig, candidateBuffer, setStatus } from './common.js';

const start = document.querySelector('#createSession');
const end = document.querySelector('#endSession');
const video = document.querySelector('#remoteVideo');
const indicator = document.querySelector('#connectionState');
let db, pc, roomRef, unsubscribers = [], stopped = false;
function subscribe(unsub) { unsubscribers.push(unsub); }
function clearSubscriptions() { for (const u of unsubscribers.splice(0)) u(); }

start.addEventListener('click', async () => {
  start.disabled = true;
  try {
    db ||= await connectFirebase();
    stopped = false;
    const roomId = crypto.randomUUID();
    roomRef = doc(db, 'cameraSessions', roomId);
    await setDoc(roomRef, { createdAt: serverTimestamp(), state: 'waiting' });
    pc = new RTCPeerConnection(rtcConfig);
    const candidates = candidateBuffer(pc);
    pc.ontrack = event => {
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch(() => setStatus('Tap the video to enable playback.'));
      document.querySelector('#placeholder').hidden = true;
      setStatus('Live video received.');
    };
    pc.onconnectionstatechange = () => {
      indicator.textContent = pc.connectionState.toUpperCase();
      if (pc.connectionState === 'connected') setStatus('Connected — iPhone video is live.');
      if (pc.connectionState === 'failed') setStatus('Connection failed. Try a different network or TURN relay.');
    };
    pc.onicecandidate = e => { if (e.candidate && !stopped) addDoc(collection(roomRef, 'viewerCandidates'), e.candidate.toJSON()).catch(console.error); };
    subscribe(onSnapshot(collection(roomRef, 'cameraCandidates'), snap => {
      for (const change of snap.docChanges()) if (change.type === 'added') candidates.add(change.doc.data());
    }, err => setStatus(err.message)));
    let answered = false;
    subscribe(onSnapshot(roomRef, async snap => {
      const data = snap.data();
      if (!data || answered || !data.offer || stopped) return;
      answered = true;
      try {
        await pc.setRemoteDescription(data.offer);
        await candidates.flush();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp }, state: 'connecting' });
        setStatus('Connecting to iPhone…');
      } catch (err) { setStatus(`Connection error: ${err.message}`); }
    }, err => setStatus(err.message)));
    const url = new URL('./camera.html', location.href);
    url.searchParams.set('room', roomId);
    document.querySelector('#cameraUrl').value = url.href;
    document.querySelector('#sessionInfo').hidden = false;
    document.querySelector('#qr').replaceChildren();
    // QR code is only a convenience; the same URL can always be copied manually.
    const qrImg = document.createElement('img');
    qrImg.alt = 'QR code for the iPhone camera page';
    qrImg.width = 190; qrImg.height = 190;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${encodeURIComponent(url.href)}`;
    document.querySelector('#qr').append(qrImg);
    end.disabled = false;
    indicator.textContent = 'WAITING';
    setStatus('Session created. Scan the QR code or copy the link to the iPhone.');
  } catch (err) { setStatus(err.message); start.disabled = false; }
});

document.querySelector('#copyLink').addEventListener('click', async () => {
  const url = document.querySelector('#cameraUrl').value;
  try { await navigator.clipboard.writeText(url); setStatus('Camera link copied.'); }
  catch { setStatus('Select and copy the camera link manually.'); }
});

end.addEventListener('click', async () => {
  stopped = true; clearSubscriptions();
  if (pc) { pc.close(); pc = null; }
  if (roomRef) { try { await updateDoc(roomRef, { state: 'ended' }); } catch {} }
  video.srcObject = null;
  document.querySelector('#placeholder').hidden = false;
  document.querySelector('#sessionInfo').hidden = true;
  indicator.textContent = 'OFFLINE';
  end.disabled = true; start.disabled = false;
  setStatus('Session ended.');
});
