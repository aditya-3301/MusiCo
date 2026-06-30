require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// If anything blows up asynchronously, log it but don't kill the process.
// Vercel serverless functions would restart anyway, but this keeps local dev alive.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (kept alive):', err.message));
process.on('uncaughtException',  (err) => console.error('Uncaught exception (kept alive):', err.message));

const express = require('express');
const { Storage } = require('megajs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// These are checked on every /stream request to gate playback behind a password.
const user_auth = process.env.admin_user; 
const pass_auth = process.env.admin_pass;

// Deterministic token so all serverless lambda instances accept it without shared memory
const session_token = crypto.createHash('sha256').update(pass_auth || '').digest('hex');

function isAuthenticated(req) {
    const cookies = req.headers.cookie;
    if (!cookies) return false;
    const match = cookies.match(new RegExp('(^| )auth_token=([^;]+)'));
    if (match) {
        return match[2] === session_token;
    }
    return false;
}

app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === user_auth && pass === pass_auth) {
        const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL;
        const securePart = isProduction ? ' Secure;' : '';
        res.setHeader('Set-Cookie', `auth_token=${session_token}; HttpOnly;${securePart} Max-Age=${30 * 24 * 60 * 60}; SameSite=Strict; Path=/`);
        res.status(200).json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// mega_storage holds the live MEGA session once it's established.
// connection_promise prevents a second login attempt while the first is still in-flight
// (important on cold starts where multiple requests can race).
let mega_storage = null;
let connection_promise = null;

async function get_mega_client() {
    if (mega_storage) return mega_storage;
    if (connection_promise) return connection_promise;

    console.log("Waking up server...");
    
    connection_promise = (async () => {
        let timeoutHandle;
        try {
            const loginPromise = new Storage({
                email: process.env.MEGA_EMAIL,
                password: process.env.MEGA_PASSWORD,
                autologin: true
            }).ready;
            
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error("MEGA_HANG: Connection timed out. Refresh now.")), 10000);
            });
            
            const storage = await Promise.race([loginPromise, timeoutPromise]);
            clearTimeout(timeoutHandle);
            mega_storage = storage;
            return mega_storage;
        } finally {
            clearTimeout(timeoutHandle);
            connection_promise = null;
        }
    })();

    return connection_promise;
}

// Each top-level folder in MEGA root is treated as a playlist.
app.get('/api/folders', async (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).send('Unauthorized');
    try {
        const storage = await get_mega_client();
        const folders = storage.root.children
            .filter(f => f.directory)
            .map(f => f.name);
            
        // Cache this at the browser level for 5 minutes to make UI navigation instant
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.json(folders);
    } catch (err) {
        console.error("Folder Fetch Error:", err);
        res.status(500).send("Error: Failed to load folders. Please refresh.");
    }
});

app.get('/api/playlist', async (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).send('Unauthorized');
    const { folder } = req.query;

    try {
        let storage;
        try {
            storage = await get_mega_client();
        } catch (err) {
            // First attempt failed (likely a stale session). Wipe state and retry once
            // before giving up — this handles Vercel warm-instance token expiry.
            console.log("First attempt failed, retrying...");
            mega_storage = null;
            connection_promise = null;
            storage = await get_mega_client();
        }

        const target_folder_name = folder || 'main'; 
        const target_folder = storage.root.children.find(f => f.name === target_folder_name && f.directory);
        
        if (!target_folder) {
            // Folder not found means the session tree is stale. Reset so next call re-fetches.
            mega_storage = null;
            return res.status(404).send(`Folder '${target_folder_name}' not found - session reset, please refresh`);
        }

        // Strip extensions from filenames — the frontend only needs clean song titles.
        const songs = target_folder.children
            .filter(f => !f.directory)
            .map(f => f.name.replace('.mp3', '').replace('.m4a', '')); 
            
        // Cache this at the browser level for 5 minutes
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.json(songs);
    } catch (err) {
        console.error("Critical Playlist Error:", err);
        // Full reset on any unhandled error so the next request starts fresh.
        mega_storage = null;
        connection_promise = null;
        res.status(500).send("Error 500: Failed to load playlist. Please try again.");
    }
});

// ── GLOBAL SEARCH ──────────────────────────────────────────────────
// Searches across all folders (playlists) for tracks matching query.
app.get('/api/search', async (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).send('Unauthorized');
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    try {
        const storage = await get_mega_client();
        const query = q.trim().toLowerCase();
        const results = [];

        storage.root.children
            .filter(f => f.directory)
            .forEach(folder => {
                folder.children
                    .filter(f => !f.directory)
                    .forEach(file => {
                        const clean_name = file.name.replace('.mp3', '').replace('.m4a', '');
                        if (clean_name.toLowerCase().includes(query)) {
                            results.push({
                                title: clean_name,
                                folder: folder.name,
                                // Include original filename for streaming
                                filename: file.name
                            });
                        }
                    });
            });

        // Cache for 2 minutes — search results change less frequently
        res.setHeader('Cache-Control', 'private, max-age=120');
        res.json(results.slice(0, 100)); // Cap at 100 results
    } catch (err) {
        console.error("Search Error:", err);
        res.status(500).send("Search failed");
    }
});

// Range-request aware streaming endpoint.
// The browser sends a Range header when seeking or when the audio element
// needs to resume from a specific byte offset, so we have to honour it.
app.get('/stream', async (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).send('no');
    
    const { filename, folder } = req.query;

    try {
        const storage = await get_mega_client();
        const target_folder_name = folder || 'main';
        const target_folder = storage.root.children.find(f => f.name === target_folder_name && f.directory);
        if (!target_folder) return res.status(404).send(`${target_folder_name} folder missing`);

        const clean_name = decodeURIComponent(filename);
        // Try exact match first, then fall back to appending the two supported extensions.
        const song_file = target_folder.children.find(f => 
            f.name === clean_name || 
            f.name === clean_name + '.mp3' ||
            f.name === clean_name + '.m4a'
        );
        
        if (!song_file) return res.status(404).send('song not in mega');

        const size = song_file.size;
        const range = req.headers.range;
        const content_type = song_file.name.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg';

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            // If the browser doesn't specify an end byte, serve at least 512 KB.
            const MIN_CHUNK = 128 * 1024;
            const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + MIN_CHUNK, size - 1);
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': content_type,
                'Cache-Control': 'private, max-age=3600',
            });
            
            const download_stream = song_file.download({ start, end });
            download_stream.on('error', (err) => {
                console.error("MEGA stream error:", err.message);
                res.destroy();
            });
            download_stream.pipe(res);
        } else {
            // No Range header — some browsers (especially mobile) send a plain GET
            // and then wait for the ENTIRE file before starting playback.
            // Fix: always respond 206 from byte 0 so the browser knows it's a
            // partial/streamable response and starts playing immediately.
            const MIN_CHUNK = 128 * 1024;
            const end = Math.min(MIN_CHUNK - 1, size - 1);
            const chunksize = end + 1;

            res.writeHead(206, {
                'Content-Range': `bytes 0-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': content_type,
                'Cache-Control': 'private, max-age=3600',
            });
            const download_stream = song_file.download({ start: 0, end });
            download_stream.on('error', (err) => {
                console.error("MEGA stream error:", err.message);
                res.destroy();
            });
            download_stream.pipe(res);
        }

    } catch (error) {
        console.error("Stream crash:", error);
        res.status(500).send('stream error');
    }
});

// Export the app for Vercel's serverless handler.
// When running locally with `node index.js`, the listen() call kicks in instead.
module.exports = app;
if (require.main === module) {
    app.listen(port, () => {
        console.log(`MusiCo running at http://localhost:${port}`);
    });
}