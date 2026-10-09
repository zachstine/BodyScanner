# iPhone-to-Classroom Camera Demo

A GitHub Pages site that streams an iPhone's rear camera to a classroom laptop using WebRTC and draws a live green stick-figure overlay using MediaPipe Pose Landmarker. GitHub Pages serves the site; Firebase Firestore handles connection setup, not the video itself. The laptop processes received frames locally in a web worker.

## One-time setup

1. Create a new Firebase project at https://console.firebase.google.com/ (prefer a separate project for this demo).
2. Add a **Web app** in Project settings and copy its `firebaseConfig` fields into `config.js`. Do not paste admin SDK credentials or service account secrets.
3. Build > Authentication > Sign-in method: enable **Anonymous**.
4. Build > Firestore Database: create a database. In Firestore > Rules replace rules with contents of `firestore.rules`, then **Publish**. These are intentionally demo-only rules; do not reuse in a production project.
5. Upload all project files, including `pose-overlay.js`, `pose-worker.js`, and `pose-drawing.js`, to a public GitHub repository. Enable GitHub Pages under Settings > Pages: Deploy from branch `main` / root.
6. Open the GitHub Pages site on your laptop and click **Start new session**. Scan its QR code with your iPhone, tap **Start Camera & Broadcast** and grant Safari camera access.

## Tips

- Camera access requires HTTPS (GitHub Pages provides it). iPhone camera permissions are requested only after tapping the start button.
- Keep Safari visible on the phone, disable auto-lock temporarily, and charge the phone.
- No microphone access, face recognition, video storage, or recordings.
- WebRTC uses Google's public STUN servers. Some campus Wi-Fi networks block direct connections; in that case a TURN server would be needed. Test on class Wi-Fi beforehand or try the laptop and iPhone on a phone hotspot.
- QR rendering uses an external QR service to generate the QR bitmap; the pairing URL is transmitted to that service. For privacy, you can skip the QR image and copy the link instead. Anyone with the pairing URL while the session is open can attempt to join.
- Each Start new session creates a new session ID; old signaling documents remain in Firestore unless removed. Delete the demo Firestore database after the presentation if you no longer need it.
- Displayed video may be delayed slightly. This is not a hosted FaceTime call, and no server is recording the video.

## Live body tracking

1. Open the viewer in a current desktop Chrome or Edge browser. Connect the iPhone exactly as before; Safari remains the camera transmitter.
2. Tracking starts automatically when video arrives. The first run downloads the tracking library, WASM runtime, and a roughly 6 MB model; allow a moment for **LOADING TRACKING** to change to **SEARCHING FOR BODY**.
3. Place the phone in landscape orientation with your full body visible and enough light. Stand clear of desks and other people, then walk through the frame. The green skeleton and optional box follow the detected body.
4. **Pause tracking** frees the model worker and hides the overlay while video continues. **Resume tracking** loads the worker again. **Show body outline box** controls only the box. **Fullscreen** expands the live monitor for projection.
5. Stop the phone camera or end the viewer session to clear tracking. Pausing the video, switching away from the viewer tab, or losing the connection also clears the overlay. Tracking restarts when live video resumes.

The model tracks one body at a time. It does not know the person's identity and may switch to another person if several people enter the frame. A green box is a pose-based outline, not an identity match. Hidden or low-confidence joints are omitted; tracking quality depends on lighting, distance, and how much of the body is visible.

Inference runs in a classic web worker with the CPU delegate so it does not block the viewer's UI. Only one frame is in flight, with a maximum input dimension of 960 pixels and a target ceiling of 15 pose updates per second. Actual tracking speed depends on the laptop. A stalled feed clears the skeleton rather than leaving a frozen body marker. Portrait footage, resizing, and fullscreen use the same `object-fit: contain` coordinate mapping as the video.

The page downloads MediaPipe `@mediapipe/tasks-vision@0.10.32` and its WASM files from `cdn.jsdelivr.net`, and the version-1 Lite pose model from `storage.googleapis.com`. These requests fetch model assets; this tracking code does not send video frames or body landmarks to those services or Firestore. A network that blocks these hosts can keep video working while tracking fails. **Retry tracking** reloads the model after an error.

References: [Google's web implementation guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) and [model and landmark overview](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).
