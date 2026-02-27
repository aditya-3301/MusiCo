require('dotenv').config();
const express = require('express');
const { Storage } = require('megajs');

const app = express();
const port = process.env.port || 3000;

// auth stuff for vercel
const user_auth = process.env.admin_user; 
const pass_auth = process.env.admin_pass;

app.use(express.static('..'));

// --- GLOBAL CONNECTION HELPERS ---
let mega_storage = null;
let connection_promise = null;

async function get_mega_client() {
    if (mega_storage) return mega_storage;
    if (connection_promise) return connection_promise;

    console.log("Waking up server...");
    
    connection_promise = new Promise(async (resolve, reject) => {
        // --- THE KILL SWITCH ---
        // If MEGA doesn't respond in 10 seconds, fail the promise
        const timeout = setTimeout(() => {
            connection_promise = null; // Clear the hang
            reject(new Error("MEGA_HANG: Connection timed out. Refresh now."));
        }, 10000);

        try {   
            const storage = await new Storage({
                email: process.env.MEGA_EMAIL,
                password: process.env.MEGA_PASSWORD,
                autologin: true
            }).ready;
            
            clearTimeout(timeout); // Success! Stop the timer
            mega_storage = storage;
            resolve(mega_storage);
        } catch (e) {
            clearTimeout(timeout);
            connection_promise = null; // Error! Clear for retry
            reject(e);
        }
    });

    return connection_promise;
}

// --- THE REGENERATED PLAYLIST ROUTE ---
app.get('/api/playlist', async (req, res) => {
    const { user, pass } = req.query;
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    try {
        let storage;
        try {
            // First attempt to get the client
            storage = await get_mega_client();
        } catch (err) {
            // RETRY LOGIC: If the first attempt failed (common after sleep), 
            // wipe everything and try one more time immediately.
            console.log("First attempt failed, retrying...");
            mega_storage = null;
            connection_promise = null;
            storage = await get_mega_client();
        }

        const main_folder = storage.root.children.find(f => f.name === 'main' && f.directory);
        if (!main_folder) {
            // If the folder isn't found, the session might be stale. Reset it.
            mega_storage = null;
            return res.status(404).send('Main folder not found - session reset, please refresh');
        }

        const songs = main_folder.children
            .filter(f => !f.directory)
            .map(f => f.name.replace('.mp3', '').replace('.m4a', '')); 
            
        res.json(songs);
    } catch (err) {
        console.error("Critical Playlist Error:", err);
        // CRITICAL: Reset the globals so the NEXT person to visit gets a clean start
        mega_storage = null;
        connection_promise = null;
        res.status(500).send('MEGA is waking up. Please refresh the page in 5 seconds.');
    }
});
// stream logic
app.get('/stream', async (req, res) => {
    const { filename, user, pass } = req.query;
    
    if (user !== user_auth || pass !== pass_auth) return res.status(401).send('no');

    // Prevent crashing if MEGA hasn't finished logging in yet
    if (!mega_storage || !mega_storage.root) {
        return res.status(503).send('MEGA is still connecting, try again in a few seconds');
    }

    try {
        // Automatically wake up/connect to MEGA if Vercel went to sleep
        const storage = await get_mega_client();
        const main_folder = storage.root.children.find(f => f.name === 'main' && f.directory);
        if (!main_folder) return res.status(404).send('main folder missing');

        const clean_name = decodeURIComponent(filename);
        // Look for exact match, .mp3, or .m4a
        const song_file = main_folder.children.find(f => 
            f.name === clean_name || 
            f.name === clean_name + '.mp3' ||
            f.name === clean_name + '.m4a'
        );
        
        if (!song_file) return res.status(404).send('song not in mega');

        // --- NEW: Handle Browser Range Requests for Buffering ---
        const size = song_file.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'audio/mpeg',
            });
            
            const download_stream = song_file.download({ start, end });
            download_stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': size,
                'Content-Type': 'audio/mpeg',
            });
            const download_stream = song_file.download();
            download_stream.pipe(res);
        }

    } catch (error) {
        console.error("Stream crash:", error);
        res.status(500).send('stream error');
    }
});

module.exports = app;