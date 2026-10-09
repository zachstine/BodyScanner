import { collection, doc, setDoc, updateDoc, onSnapshot, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { connectFirebase, rtcConfig, candidateBuffer, setStatus } from './common.js';
import { PoseOverlay } from './pose-overlay.js';

const start = document.querySelector('#createSession');
const end = document.querySelector('#endSession');
const video = document.querySelector('#remoteVideo');
const indicator = document.querySelector('#connectionState');
const toggleTracking = document.querySelector('#toggleTracking');
const trackingBadge = document.querySelector('#trackingBadge');
const fullscreen = document.querySelector('#fullscreen');
const monitor = document.querySelector('#monitor');
const trackingLabels = {
  waiting: 'WAITING FOR VIDEO',
  loading: 'LOADING TRACKING',
  searching: 'SEARCHING FOR BODY',
  tracking: 'BODY TRACKED',
  paused: 'TRACKING PAUSED',
  error: 'TRACKING UNAVAILABLE'
};
const tracking = new PoseOverlay({
  video,
  canvas: document.querySelector('#poseCanvas'),
  onStatus(state, message) {
    trackingBadge.dataset.state = state;
    trackingBadge.textContent = trackingLabels[state];
    document.querySelector('#trackingStatus').textContent = message;
    toggleTracking.textContent = state === 'error' ? 'Retry tracking'
      : toggleTracking.getAttribute('aria-pressed') === 'true' ? 'Pause tracking' : 'Resume tracking';
  },
  onRate(rate) {
    document.querySelector('#trackingRate').textContent = rate === null ? '— fps' : `${rate} fps`;
  }
});

toggleTracking.addEventListener('click', () => {
  if (tracking.failed) {
    tracking.retry();
    return;
  }
  const enabled = !tracking.enabled;
  toggleTracking.setAttribute('aria-pressed', String(enabled));
  tracking.setEnabled(enabled);
});
document.querySelector('#showBoundingBox').addEventListener('change', event => {
  tracking.setShowBounds(event.target.checked);
});
fullscreen.disabled = !document.fullscreenEnabled;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await monitor.requestFullscreen();
  } catch {
    setStatus('Fullscreen is unavailable in this browser window.');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});
video.addEventListener('click', () => {
  if (video.srcObject) video.play().catch(() => setStatus('Playback could not start. Reconnect the camera.'));
});
video.addEventListener('playing', () => {
  if (video.srcObject && !stopped) tracking.setStreamAvailable(true);
});
video.addEventListener('pause', () => tracking.setStreamAvailable(false));
video.addEventListener('emptied', () => tracking.setStreamAvailable(false));

let db, pc, roomRef, unsubscribers = [], stopped = false;
function subscribe(unsub) { unsubscribers.push(unsub); }
function clearSubscriptions() { for (const u of unsubscribers.splice(0)) u(); }

function resetViewer(message) {
  stopped = true;
  clearSubscriptions();
  tracking.setStreamAvailable(false);
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    pc.close();
    pc = null;
  }
  video.pause();
  video.srcObject = null;
  document.querySelector('#placeholder').hidden = false;
  document.querySelector('#sessionInfo').hidden = true;
  indicator.textContent = 'OFFLINE';
  end.disabled = true;
  start.disabled = false;
  setStatus(message);
}

start.addEventListener('click', async () => {
  start.disabled = true;
  try {
    db ||= await connectFirebase();
    stopped = false;
    const roomId = crypto.randomUUID();
    roomRef = doc(db, 'cameraSessions', roomId);
    await setDoc(roomRef, { createdAt: serverTimestamp(), state: 'waiting' });
    pc = new RTCPeerConnection(rtcConfig);
    const peer = pc;
    const sessionRef = roomRef;
    const candidates = candidateBuffer(pc);
    pc.ontrack = event => {
      if (pc !== peer || stopped) return;
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      video.srcObject = remoteStream;
      video.play().catch(() => setStatus('Tap the video to enable playback.'));
      tracking.setStreamAvailable(true);
      event.track.addEventListener('mute', () => {
        if (video.srcObject === remoteStream) tracking.setStreamAvailable(false);
      });
      event.track.addEventListener('unmute', () => {
        if (video.srcObject === remoteStream && !stopped) tracking.setStreamAvailable(true);
      });
      event.track.addEventListener('ended', () => {
        if (video.srcObject === remoteStream) tracking.setStreamAvailable(false);
      });
      document.querySelector('#placeholder').hidden = true;
      setStatus('Live video received.');
    };
    pc.onconnectionstatechange = () => {
      if (pc !== peer || stopped) return;
      indicator.textContent = peer.connectionState.toUpperCase();
      if (peer.connectionState === 'connected') {
        tracking.setStreamAvailable(Boolean(video.srcObject));
        setStatus('Connected — iPhone video is live.');
      } else {
        tracking.setStreamAvailable(false);
      }
      if (peer.connectionState === 'failed') setStatus('Connection failed. Try a different network or TURN relay.');
    };
    pc.onicecandidate = event => {
      if (event.candidate && pc === peer && !stopped) {
        addDoc(collection(sessionRef, 'viewerCandidates'), event.candidate.toJSON()).catch(console.error);
      }
    };
    subscribe(onSnapshot(collection(roomRef, 'cameraCandidates'), snap => {
      for (const change of snap.docChanges()) if (change.type === 'added') candidates.add(change.doc.data());
    }, err => setStatus(err.message)));
    let answered = false;
    subscribe(onSnapshot(roomRef, async snap => {
      const data = snap.data();
      if (pc !== peer || stopped) return;
      if (data?.state === 'ended') {
        resetViewer('iPhone camera stopped. Start a new session to reconnect.');
        return;
      }
      if (!data || answered || !data.offer || stopped) return;
      answered = true;
      try {
        await peer.setRemoteDescription(data.offer);
        await candidates.flush();
        if (pc !== peer || stopped) return;
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (pc !== peer || stopped) return;
        await updateDoc(sessionRef, { answer: { type: answer.type, sdp: answer.sdp }, state: 'connecting' });
        setStatus('Connecting to iPhone…');
      } catch (err) {
        if (pc === peer && !stopped) setStatus(`Connection error: ${err.message}`);
      }
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
  } catch (err) { resetViewer(err.message); }
});

document.querySelector('#copyLink').addEventListener('click', async () => {
  const url = document.querySelector('#cameraUrl').value;
  try { await navigator.clipboard.writeText(url); setStatus('Camera link copied.'); }
  catch { setStatus('Select and copy the camera link manually.'); }
});

end.addEventListener('click', async () => {
  const endedRoom = roomRef;
  roomRef = null;
  resetViewer('Session ended.');
  if (endedRoom) {
    try { await updateDoc(endedRoom, { state: 'ended' }); } catch {}
  }
});

window.addEventListener('pagehide', () => tracking.setStreamAvailable(false));
window.addEventListener('pageshow', () => {
  if (video.srcObject && !stopped && pc?.connectionState === 'connected') {
    tracking.setStreamAvailable(true);
  }
});
