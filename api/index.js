require('dotenv').config();

// If anything blows up asynchronously, log it but don't kill the process.
// Vercel serverless functions would restart anyway, but this keeps local dev alive.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (kept alive):', err.message));
process.on('uncaughtException',  (err) => console.error('Uncaught exception (kept alive):', err.message));

const express = require('express');
const { Storage } = require('megajs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// These are checked on every /stream request to gate playback behind a password.
const user_auth = process.env.admin_user; 
const pass_auth = process.env.admin_pass;

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
    
    connection_promise = new Promise(async (resolve, reject) => {
        // MEGA login can stall silently. Kill it after 10 s and let the caller
        // surface a "refresh now" message rather than hanging forever.
        const timeout = setTimeout(() => {
            connection_promise = null;
            reject(new Error("MEGA_HANG: Connection timed out. Refresh now."));
        }, 10000);

        try {   
            const storage = await new Storage({
                email: process.env.MEGA_EMAIL,
                password: process.env.MEGA_PASSWORD,
                autologin: true
            }).ready;
            
            clearTimeout(timeout);
            mega_storage = storage;
            connection_promise = null;
            resolve(mega_storage);
        } catch (e) {
            clearTimeout(timeout);
            connection_promise = null;
            reject(e);
        }
    });

    return connection_promise;
}

// Each top-level folder in MEGA root is treated as a playlist.
app.get('/api/folders', async (req, res) => {
    try {
        const storage = await get_mega_client();
        const folders = storage.root.children
            .filter(f => f.directory)
            .map(f => f.name);
            
        res.json(folders);
    } catch (err) {
        console.error("Folder Fetch Error:", err);
        res.status(500).send(`Error: ${err.message}`);
    }
});

app.get('/api/playlist', async (req, res) => {
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
            
        res.json(songs);
    } catch (err) {
        console.error("Critical Playlist Error:", err);
        // Full reset on any unhandled error so the next request starts fresh.
        mega_storage = null;
        connection_promise = null;
        res.status(500).send(`Error 500:Error is -> ${err.message}\n\n[If it says EBLOCKED, i have to change my mega password(Its a very rare error)]`);
    }
});

// Range-request aware streaming endpoint.
// The browser sends a Range header when seeking or when the audio element
// needs to resume from a specific byte offset, so we have to honour it.
app.get('/stream', async (req, res) => {
    const { filename, user, pass, folder } = req.query;
    
    // Simple credential check — credentials travel in the query string which
    // is fine here since the app is personal and already behind HTTPS on Vercel.
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

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
            // Larger chunks mean fewer round-trips and smoother playback on slow connections.
            const MIN_CHUNK = 512 * 1024;
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
            download_stream.pipe(res);
        } else {
            // No Range header — send the whole file (happens on some mobile browsers).
            res.writeHead(200, {
                'Content-Length': size,
                'Content-Type': content_type,
                'Cache-Control': 'private, max-age=3600',
            });
            const download_stream = song_file.download();
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
