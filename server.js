const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Readable } = require('stream');

const app = express();
const port = 3000;

// Broad CORS Configuration to allow custom headers (like our G2O secret) to pass through Preflight
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json());
app.use(express.static(__dirname));

ffmpeg.setFfmpegPath(ffmpegStatic);

// ==========================================
// Preview Video Route 
// ==========================================
app.get('/api/local-preview', (req, res) => {
    const videoPath = path.join(__dirname, 'mp4', 'test.mp4');
    if (!fs.existsSync(videoPath)) return res.status(404).send('Video not found');
    res.sendFile(videoPath);
});

// ==========================================
// Harmonic MSL5 API Routes
// ==========================================
const HARMONIC_API_HOST = "gateway.mslapis.net";

app.post('/api/msl5/config', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Missing Bearer token." });

    try {
        const response = await fetch(`https://${HARMONIC_API_HOST}/api/v1/streams`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return res.status(response.status).json({ error: `API Error ${response.status}` });

        const streamsData = await response.json();
        const domains = new Set();
        const streams = new Set();

        streamsData.forEach(stream => {
            if (stream.host_name) domains.add(stream.host_name);
            if (stream.stream_id) streams.add(stream.stream_id);
        });

        res.json({ domains: Array.from(domains), streams: Array.from(streams) });
    } catch (error) {
        res.status(500).json({ error: "Failed to connect to Harmonic API." });
    }
});

app.post('/api/msl5/reports', async (req, res) => {
    const { token, streamId } = req.body;
    if (!token || !streamId) return res.status(400).json({ error: "Missing token or stream ID." });

    try {
        const response = await fetch(`https://${HARMONIC_API_HOST}/api/v1/streams/${streamId}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return res.status(response.status).json({ error: `API Error ${response.status}` });

        const streamData = await response.json();
        res.json(streamData);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch stream reports." });
    }
});

// ==========================================
// Proxy Route (Flawless Base URL Mirroring)
// ==========================================
// FIX: Added nonce parameter to correctly format the trailing element of the authData string
function generateG2OHeaders(urlPath, secretKey, nonceStr) {
    if (!secretKey) return {};
    const authData = `5, 0.0.0.0, 0.0.0.0, ${Math.floor(Date.now() / 1000)}, ${crypto.randomBytes(4).readUInt32BE(0)}, ${nonceStr}`;
    const signature = crypto.createHmac('sha256', secretKey).update(`${authData}${urlPath}`).digest('base64');
    return { 'X-Akamai-G2O-Auth-Data': authData, 'X-Akamai-G2O-Auth-Sign': signature };
}

app.get('/proxy/*', async (req, res) => {
    try {
        const targetUrl = req.originalUrl.substring(7);
        if (!targetUrl.startsWith('http')) return res.status(400).send("Invalid proxy target");

        // Extract both Key and Nonce sent from frontend Custom Headers
        const g2oSecret = req.headers['x-mlot-g2o-secret'] || '';
        const g2oNonce = req.headers['x-mlot-g2o-nonce'] || '';

        const headers = {};
        const skipRequestHeaders = ['host', 'connection', 'origin', 'referer', 'accept-encoding', 'user-agent', 'x-mlot-g2o-secret', 'x-mlot-g2o-nonce'];
        for (const key in req.headers) {
            if (!skipRequestHeaders.includes(key.toLowerCase())) {
                headers[key] = req.headers[key];
            }
        }

        if (g2oSecret) {
            Object.assign(headers, generateG2OHeaders(new URL(targetUrl).pathname, g2oSecret, g2oNonce));
        }

        const response = await fetch(targetUrl, { headers });
        
        res.status(response.status);
        const skipResponseHeaders = ['content-encoding', 'content-length', 'access-control-allow-origin'];
        response.headers.forEach((value, name) => {
            if (!skipResponseHeaders.includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });
        
        Readable.fromWeb(response.body).pipe(res);

    } catch (error) {
        console.error("Proxy Error:", error);
        res.status(500).send('Proxy Failed');
    }
});

// ==========================================
// Live Logs Stream
// ==========================================
let logClients = [];
app.get('/api/ingest/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    logClients.push(res);
    req.on('close', () => logClients = logClients.filter(client => client !== res));
});

function broadcastLog(target, msg) {
    console.log(`[${target.toUpperCase()}] ${msg}`);
    logClients.forEach(client => client.write(`data: ${JSON.stringify({ target, msg })}\n\n`));
}

// ==========================================
// Dual Ingest Control (Primary & Backup)
// ==========================================
const activeCommands = { primary: null, backup: null };

app.post('/api/ingest/start', (req, res) => {
    const { target, sourceType, localPath, loopCount, domain, streamId, eventName, master, addTimestamp } = req.body;
    
    if (!target || !['primary', 'backup'].includes(target)) return res.status(400).json({ error: "Invalid target." });
    if (activeCommands[target]) return res.status(400).json({ error: "Running" });

    let command;
    const loops = loopCount !== undefined ? String(loopCount) : '5';

    if (sourceType === 'default-mp4') {
        command = ffmpeg(path.join(__dirname, 'mp4', 'test.mp4')).inputOptions(['-stream_loop', loops, '-re']); 
    } else if (sourceType === 'local-file') {
        command = ffmpeg(localPath).inputOptions(['-stream_loop', loops, '-re']);
    }

    const destinationUrl = `http://${domain}/${streamId}/${eventName}/${master}`;

    const fixedTranscodeOptions = [
        '-preset veryfast', 
        '-b:v 3000k', 
        '-pix_fmt yuv420p',
        '-g 120',
        '-keyint_min 120',
        '-sc_threshold 0',
        '-ac 2',
        '-f hls',
        '-method PUT',
        '-hls_time 4',
        '-hls_list_size 5',
        '-hls_flags delete_segments'
    ];

    if (addTimestamp) {
        let fontPath = path.join(__dirname, 'fonts', 'font.ttf');
        
        if (!fs.existsSync(fontPath)) {
            broadcastLog(target, "WARNING: fonts/font.ttf not found! Falling back to standard ingest without timestamp.");
            command.videoCodec('libx264')
                   .audioCodec('aac')
                   .outputOptions(fixedTranscodeOptions);
        } else {
            fontPath = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');

            command.videoFilters(`drawtext=fontfile='${fontPath}':text='M-LOT %{localtime}':x=10:y=10:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.6`)
                   .videoCodec('libx264')
                   .audioCodec('aac')
                   .outputOptions(fixedTranscodeOptions);
        }
    } else {
        command.videoCodec('libx264')
               .audioCodec('aac')
               .outputOptions(fixedTranscodeOptions);
    }

    command.output(destinationUrl);
    activeCommands[target] = command;

    activeCommands[target].on('start', cmd => {
        broadcastLog(target, "Started FFmpeg with command: " + cmd);
        res.json({ status: "running", command: cmd });
    })
    .on('stderr', stderrLine => broadcastLog(target, stderrLine))
    .on('error', err => {
        broadcastLog(target, "Error: " + err.message);
        activeCommands[target] = null;
    })
    .on('end', () => {
        broadcastLog(target, "Ingest finished normally.");
        activeCommands[target] = null;
    });

    activeCommands[target].run();
});

app.post('/api/ingest/stop', (req, res) => {
    const { target } = req.body;
    if (activeCommands[target]) { 
        activeCommands[target].kill('SIGKILL'); 
        activeCommands[target] = null; 
        broadcastLog(target, "Ingest stopped by user.");
    }
    res.json({ status: "stopped" });
});

app.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));