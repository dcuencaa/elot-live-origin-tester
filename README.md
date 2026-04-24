# ELOT (Edge & Live Origin Tester)
ELOT  is a unified, locally-hosted web utility designed for end-to-end testing of live video streaming workflows. It allows to simulate live stream ingest (pushing HLS/DASH to origin servers) and validate playback through CDNs (like Akamai) while bypassing common local testing hurdles like CORS and DNS spoofing.

----------
## Installation & Setup

ELOT runs entirely on your local machine. You only need to have [Node.js](https://nodejs.org/) installed.

1.  **Clone or Download** this repository.
2.  **Run the Start Script:**
    * **Mac/Linux:** Double-click `start.sh` (or run `./start.sh` in the terminal).
    * **Windows:** Double-click `start.bat`.
    *(Note: These scripts will automatically run `npm install` to grab the required packages and then start the server).*
3.  **Open your Browser:** Navigate to `http://localhost:3000`.
----------

----------
## 📖 User Guide

ELOT is divided into three main tabs:

### 1. Ingest
* **Video Source:** Choose the default "Default Test MP4" loop or input the absolute path to a local `.mp4` file.
* **MSL5 Configuration:** Enter a Bearer token to automatically fetch and populate your Harmonic MSL5 primary/backup domains and Stream IDs.
* **Timestamp Filter:** Check this to burn a live local clock directly into the video feed to measure glass-to-glass latency.
* **Execution:** Click **Start Primary** (and optionally **Start Backup**) to begin HTTP PUT ingest to your origin. Real-time FFmpeg logs will appear on the right.

Note on the Default Test MP4 File:
To keep this repository lightweight, the default testing video is not included. To use the "Default Test MP4" option as your ingest source, please follow these steps:

1.  **Download the sample video zip file here**:
     https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip
     bbb_sunflower_1080p_30fps_normal.mp4.zip (from the official Blender foundation).
2.  **Extract the zip file.**
3.  **Move the extracted video file into the ./mp4/ folder located in the root of this repository and renam it "test.mp4".**

### 2. Playback
* **Configuration:** Select your CDN origin (e.g., Akamai), format prefix, and custom headers.
* **CMCD & G2O:** Toggle Common Media Client Data tracking or G2O authentication to test edge behaviors. 
* **Local Proxy Route:** Keep this **checked** to bypass browser CORS errors when testing raw edge URLs. Turn it off if you need to test IP-bound DRM tokens.
* **Viewer:** Click **Load Stream**. Use the **Go to LIVE** button to mathematically jump to the exact live edge of the stream. Compare the burned-in video timestamp to the UI latency clock to measure drift.

### 3. API Reports
* Input your Harmonic Bearer token and Stream ID in the Ingest tab, then click **Fetch Data** here to pull real-time JSON diagnostics directly from the Harmonic API.
----------

----------
## Technical Architecture

ELOT is built on a lightweight, modular architecture to ensure maximum compatibility and zero external dependencies (aside from Node.js).

* **Backend (Node.js & Express):** * **Transmuxing Engine:** Uses `fluent-ffmpeg` and `ffmpeg-static` to spin up headless FFmpeg processes. It strictly enforces broadcast-standard video formatting (`-g 120` keyframes, `-sc_threshold 0`, stereo `-ac 2` downmixing) to prevent browser MSE decoder crashes (`bufferAppendingError`).
    * **CORS-Bypass Proxy:** A custom `/proxy/*` route that perfectly mirrors base URLs while injecting missing `Access-Control-Allow-Origin` headers, allowing native browser players to fetch fragments from strict CDN edges.
    * **G2O Auth Generator:** Natively calculates and signs Akamai G2O edge authentication headers via Node's `crypto` module.
    * **Real-time Logging:** Uses Server-Sent Events (SSE) to pipe FFmpeg `stderr` directly to the browser DOM.
* **Frontend (Vanilla JS & Bootstrap 5):**
    * **Playback Engines:** Integrates **HLS.js** for Apple HLS streams and Google's **Shaka Player** for DASH/CMAF.
    * **CMCD Integration:** Natively passes Common Media Client Data via query strings or headers for CDN log validation.
---

